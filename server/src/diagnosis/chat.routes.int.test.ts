import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app.js';
import { prisma } from '../db/client.js';
import { createEvent } from '../ingest/events.service.js';
import type { ManualSubmission } from '../ingest/schemas.js';
import type { ChatMessage } from './prompt.js';

// Integration tests against a real Postgres, exercising POST /investigations/:id/chat end to end:
// route → service → context assembly → persistence. The only thing stubbed is the OpenAI network
// call: we mock `createOpenAIChatClient` so the service's default streams a deterministic answer. That
// proves the real wiring — SSE framing, 404/400 mapping, the user/assistant rows persisted in seq
// order, and per-turn accounting on the assistant row — while staying free and offline. The key-gated
// real-call path lives in chat.live.int.test.ts.

// `vi.mock` is hoisted above imports; `vi.hoisted` lifts the shared state its factory closes over —
// the scripted answer deltas and a capture slot for the messages the client is handed (so the budget
// test can assert the assembled context was truncated).
const { answerDeltas, usage, capturedMessages, behavior } = vi.hoisted(() => ({
  answerDeltas: ['Because ', 'the 401 names an expired key, not a network fault.'],
  usage: { promptTokens: 1500, completionTokens: 25 },
  capturedMessages: [] as ChatMessage[][],
  // Per-test switch so one case can make the stream fail after a delta (the error-branch test).
  behavior: { shouldThrow: false },
}));

vi.mock('./chat.client.js', () => ({
  createOpenAIChatClient: () => ({
    async *streamChat(messages: ChatMessage[]) {
      capturedMessages.push(messages);
      let content = '';
      for (const text of answerDeltas) {
        content += text;
        yield { type: 'delta', text };
        // Fail mid-stream (after at least one delta reached the client) when the test asks for it.
        if (behavior.shouldThrow) {
          throw new Error('simulated mid-stream failure');
        }
      }
      yield { type: 'done', content, model: 'gpt-6-luna', usage };
    },
  }),
}));

async function resetDb(): Promise<void> {
  await prisma.investigationMessage.deleteMany();
  await prisma.investigation.deleteMany();
  await prisma.deliveryAttempt.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.captureEndpoint.deleteMany();
}

const cannedDiagnosis = {
  failureCategory: 'authentication',
  rootCause: 'Rejected with HTTP 401 and an api_key_expired error code.',
  confidence: 0.96,
  evidence: [
    { field: 'attempts[0].responseStatus', value: '401', note: 'Rejected on authentication.' },
  ],
  remediationSteps: ['Rotate the expired API key.'],
  reachabilityAssessment: 'reachable',
  isSpeculative: false,
};

const submission: ManualSubmission = {
  source: 'stripe',
  eventType: 'invoice.payment_failed',
  payload: { id: 'evt_test', type: 'invoice.payment_failed' },
  headers: { 'content-type': 'application/json' },
  attempts: [
    {
      requestUrl: 'https://hooks.example-app.com/webhooks/stripe',
      requestMethod: 'POST',
      requestHeaders: { authorization: 'Bearer sk-should-be-redacted' },
      requestBody: { id: 'evt_test' },
      responseStatus: 401,
      responseHeaders: { 'www-authenticate': 'Bearer error="invalid_token"' },
      responseBody: { error: { code: 'api_key_expired' } },
      latencyMs: 120,
    },
  ],
};

/** Seed an event + a persisted investigation over it, returning the investigation id. */
async function seedInvestigation(
  overrides?: Partial<ManualSubmission>,
): Promise<{ eventId: string; investigationId: string }> {
  const event = await createEvent({ ...submission, ...overrides });
  const investigation = await prisma.investigation.create({
    data: {
      event: { connect: { id: event.id } },
      diagnosis: cannedDiagnosis as unknown as Prisma.InputJsonValue,
      failureCategory: 'authentication',
      confidence: 0.96,
      model: 'gpt-6-luna',
      promptVersion: 'diagnosis-v2',
      promptTokens: 1200,
      completionTokens: 300,
      costUsd: new Prisma.Decimal('0.0003'),
    },
  });
  return { eventId: event.id, investigationId: investigation.id };
}

/** Parse an SSE response body into `{ event, data }` records. */
function parseSSE(body: string): Array<{ event: string; data: unknown }> {
  return body
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const eventLine = block.split('\n').find((l) => l.startsWith('event: '))!;
      const dataLine = block.split('\n').find((l) => l.startsWith('data: '))!;
      return {
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)),
      };
    });
}

beforeEach(async () => {
  capturedMessages.length = 0;
  behavior.shouldThrow = false;
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /investigations/:id/chat', () => {
  it('streams delta events then a done event carrying the message id and accounting', async () => {
    const { investigationId } = await seedInvestigation();

    const res = await request(app)
      .post(`/investigations/${investigationId}/chat`)
      .send({ message: 'Why not a network issue?' })
      .expect(200);

    expect(res.headers['content-type']).toContain('text/event-stream');

    const events = parseSSE(res.text);
    const deltas = events.filter((e) => e.event === 'delta');
    expect(deltas.map((e) => (e.data as { text: string }).text)).toEqual(answerDeltas);

    const done = events.find((e) => e.event === 'done');
    expect(done).toBeDefined();
    const doneData = done!.data as {
      investigationId: string;
      messageId: string;
      model: string;
      usage: { promptTokens: number; completionTokens: number };
      costUsd: string;
    };
    expect(doneData.investigationId).toBe(investigationId);
    expect(doneData.model).toBe('gpt-6-luna');
    expect(doneData.usage).toEqual(usage);
    expect(typeof doneData.messageId).toBe('string');
  });

  it('persists the user question and the assistant answer in seq order, with accounting on the answer', async () => {
    const { investigationId } = await seedInvestigation();

    await request(app)
      .post(`/investigations/${investigationId}/chat`)
      .send({ message: 'Why not a network issue?' })
      .expect(200);

    const messages = await prisma.investigationMessage.findMany({
      where: { investigationId },
      orderBy: { seq: 'asc' },
    });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);

    const [userRow, assistantRow] = messages;
    expect(userRow!.content).toBe('Why not a network issue?');
    // The user row carries no accounting.
    expect(userRow!.model).toBeNull();
    expect(userRow!.promptTokens).toBeNull();

    // The assistant row carries the full answer and the per-turn accounting (CLAUDE.md rule).
    expect(assistantRow!.content).toBe(answerDeltas.join(''));
    expect(assistantRow!.model).toBe('gpt-6-luna');
    expect(assistantRow!.promptTokens).toBe(usage.promptTokens);
    expect(assistantRow!.completionTokens).toBe(usage.completionTokens);
    expect(assistantRow!.costUsd).not.toBeNull();
    expect(Number(assistantRow!.costUsd)).toBeGreaterThan(0);
  });

  it('replays prior chat turns into the next request, in seq order', async () => {
    const { investigationId } = await seedInvestigation();

    // First turn establishes a user+assistant pair in the thread.
    await request(app)
      .post(`/investigations/${investigationId}/chat`)
      .send({ message: 'First question?' })
      .expect(200);

    capturedMessages.length = 0;

    // Second turn must replay the first turn between the context block and the new question.
    await request(app)
      .post(`/investigations/${investigationId}/chat`)
      .send({ message: 'Second question?' })
      .expect(200);

    const sent = capturedMessages.at(-1)!;
    const roles = sent.map((m) => m.role);
    expect(roles[0]).toBe('system');
    expect(roles[1]).toBe('user'); // the diagnosis snapshot + logs context block
    const texts = sent.map((m) => ('content' in m ? (m.content ?? '') : ''));
    expect(texts).toContain('First question?');
    expect(texts).toContain('Because the 401 names an expired key, not a network fault.');
    // The new question is last.
    expect(texts.at(-1)).toBe('Second question?');
  });

  it('returns 404 (JSON, not a stream) for an unknown investigation', async () => {
    const res = await request(app)
      .post('/investigations/does-not-exist/chat')
      .send({ message: 'Why?' })
      .expect(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toEqual({ error: 'NotFound' });
    // No message rows were written for a non-existent investigation.
    expect(await prisma.investigationMessage.count()).toBe(0);
  });

  it('returns 400 for an empty message', async () => {
    const { investigationId } = await seedInvestigation();
    const res = await request(app)
      .post(`/investigations/${investigationId}/chat`)
      .send({ message: '   ' })
      .expect(400);
    expect(res.body).toEqual({ error: 'BadRequest' });
    expect(await prisma.investigationMessage.count()).toBe(0);
  });

  it('returns 400 for a missing message field', async () => {
    const { investigationId } = await seedInvestigation();
    await request(app).post(`/investigations/${investigationId}/chat`).send({}).expect(400);
  });

  it('keeps a very long log thread within the budget by truncating bodies (does not error)', async () => {
    // An attempt with a pathologically large responseBody — the chat request must still succeed, with
    // the assembled log block truncated (pointer present) rather than blowing the context window.
    const { investigationId } = await seedInvestigation({
      attempts: [
        {
          ...submission.attempts[0]!,
          responseBody: { blob: 'z'.repeat(40_000), error: { code: 'api_key_expired' } },
        },
      ],
    });

    await request(app)
      .post(`/investigations/${investigationId}/chat`)
      .send({ message: 'Which field shows the failure?' })
      .expect(200);

    // The context block the client received was truncated with the pointer, and the citable status
    // field survived intact (bodies truncate; short fields and headers do not).
    const context = capturedMessages
      .at(-1)!
      .map((m) => ('content' in m ? (m.content ?? '') : ''))[1];
    expect(context).toContain('[truncated — showing first');
    expect(context).toContain('attempts[0].responseStatus: 401');
  });

  it('logs and emits an error event on a mid-stream failure, discarding the partial answer', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    behavior.shouldThrow = true;
    const { investigationId } = await seedInvestigation();

    // The headers are already committed by the time the stream fails, so the request still completes
    // with a 200 — the failure surfaces as a terminal SSE `error` event, not an HTTP error status.
    const res = await request(app)
      .post(`/investigations/${investigationId}/chat`)
      .send({ message: 'Why not a network issue?' })
      .expect(200);

    const events = parseSSE(res.text);
    // The pre-failure delta reached the client, then a terminal error event; no `done`.
    expect(events.some((e) => e.event === 'delta')).toBe(true);
    expect(events.find((e) => e.event === 'error')?.data).toEqual({ error: 'ChatStreamFailed' });
    expect(events.some((e) => e.event === 'done')).toBe(false);

    // The failure was logged server-side (Fix 1), not only surfaced to the client.
    expect(consoleError).toHaveBeenCalled();

    // The interrupted turn is discarded: the question persisted, but no assistant answer row.
    const messages = await prisma.investigationMessage.findMany({ where: { investigationId } });
    expect(messages.map((m) => m.role)).toEqual(['user']);

    consoleError.mockRestore();
  });
});
