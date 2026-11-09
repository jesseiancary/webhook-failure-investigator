import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/client.js';
import { createEvent } from '../ingest/events.service.js';
import type { ManualSubmission } from '../ingest/schemas.js';
import { DiagnosisSchema, type Diagnosis } from './diagnosis.schema.js';
import { investigateEvent } from './diagnosis.service.js';
import type { DiagnosisClient, DiagnosisToolkit, PersistedToolCall } from './openai.js';
import { PROMPT_VERSION, type ChatMessage } from './prompt.js';

// Integration test against a real Postgres (DATABASE_URL must point at a test database). Exercises
// the full investigate flow — message assembly, toolkit injection, diagnosis, cost accounting,
// persistence (including the retrieval-trace InvestigationMessage rows) — with a deterministic stub
// client, so no OPENAI_API_KEY or network is involved. The key-gated real-call test (which exercises
// the actual tool-calling loop) lives in diagnosis.live.int.test.ts.

async function resetDb(): Promise<void> {
  await prisma.investigation.deleteMany();
  await prisma.deliveryAttempt.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.captureEndpoint.deleteMany();
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

const submission: ManualSubmission = {
  source: 'stripe',
  eventType: 'invoice.payment_failed',
  payload: { id: 'evt_test', type: 'invoice.payment_failed' },
  headers: { authorization: 'Bearer sk-should-be-redacted', 'content-type': 'application/json' },
  attempts: [
    {
      requestUrl: 'https://hooks.example-app.com/webhooks/stripe',
      requestMethod: 'POST',
      requestHeaders: { authorization: 'Bearer sk-should-be-redacted' },
      requestBody: { id: 'evt_test' },
      responseStatus: 401,
      responseHeaders: { 'www-authenticate': 'Bearer realm="api"' },
      responseBody: { error: { code: 'api_key_expired' } },
      latencyMs: 120,
    },
  ],
};

const cannedDiagnosis: Diagnosis = {
  failureCategory: 'authentication',
  rootCause: 'Rejected with 401 and an expired-key error code.',
  confidence: 0.96,
  evidence: [{ field: 'attempts[0].responseStatus', value: '401', note: 'Unauthorized.' }],
  remediationSteps: ['Rotate the API key.'],
  reachabilityAssessment: 'reachable',
  isSpeculative: false,
};

/**
 * A stub client: records the messages and toolkit it was handed and returns a canned diagnosis plus
 * a canned retrieval trace (one get_delivery_history call + result), so the persistence of the
 * InvestigationMessage rows is exercised without a model or network.
 */
function makeStubClient(): DiagnosisClient & {
  lastMessages: ChatMessage[];
  lastToolkit: DiagnosisToolkit | undefined;
  toolCalls: PersistedToolCall[];
} {
  const stub = {
    lastMessages: [] as ChatMessage[],
    lastToolkit: undefined as DiagnosisToolkit | undefined,
    toolCalls: [
      {
        id: 'call_hist_1',
        name: 'get_delivery_history',
        arguments: JSON.stringify({ eventId: 'placeholder' }),
        result: 'DELIVERY HISTORY — 1 attempt(s)\nattempts[0].responseStatus: 401',
      },
    ] as PersistedToolCall[],
    async runDiagnosis(messages: ChatMessage[], toolkit?: DiagnosisToolkit) {
      stub.lastMessages = messages;
      stub.lastToolkit = toolkit;
      return {
        diagnosis: cannedDiagnosis,
        usage: { promptTokens: 1200, completionTokens: 300 },
        model: 'gpt-4o-2024-08-06',
        toolCalls: stub.toolCalls,
      };
    },
  };
  return stub;
}

describe('investigateEvent', () => {
  it('returns null for an unknown event (the route maps this to 404)', async () => {
    expect(await investigateEvent('does-not-exist', { client: makeStubClient() })).toBeNull();
  });

  it('persists a grounded Investigation with hoisted columns and cost accounting', async () => {
    const event = await createEvent(submission);
    const client = makeStubClient();

    const investigation = await investigateEvent(event.id, { client });
    expect(investigation).not.toBeNull();

    // The stored diagnosis Json round-trips through the shared contract.
    expect(DiagnosisSchema.safeParse(investigation?.diagnosis).success).toBe(true);

    // Queryable columns are hoisted from the diagnosis.
    expect(investigation?.eventId).toBe(event.id);
    expect(investigation?.failureCategory).toBe('authentication');
    expect(investigation?.confidence).toBeCloseTo(0.96, 10);

    // Accounting (CLAUDE.md rule: model + tokens + cost on every Investigation).
    expect(investigation?.model).toBe('gpt-4o-2024-08-06');
    expect(investigation?.promptVersion).toBe(PROMPT_VERSION);
    expect(investigation?.promptTokens).toBe(1200);
    expect(investigation?.completionTokens).toBe(300);
    // 1200 * 2.5/1e6 + 300 * 10/1e6 = 0.003 + 0.003 = 0.006.
    expect(new Prisma.Decimal(investigation!.costUsd).equals(new Prisma.Decimal('0.006'))).toBe(
      true,
    );
  });

  it('persists the retrieval trace as assistant + tool InvestigationMessage rows', async () => {
    const event = await createEvent(submission);
    const client = makeStubClient();

    const investigation = await investigateEvent(event.id, { client });
    const messages = await prisma.investigationMessage.findMany({
      where: { investigationId: investigation!.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(messages.map((m) => m.role)).toEqual(['assistant', 'tool']);

    // The assistant row carries the requested call in toolCalls Json; the tool row carries the result.
    const [assistant, tool] = messages;
    expect(assistant?.toolCalls).toEqual([
      {
        id: 'call_hist_1',
        name: 'get_delivery_history',
        arguments: JSON.stringify({ eventId: 'placeholder' }),
      },
    ]);
    expect(tool?.toolCalls).toBeNull();
    expect(tool?.content).toContain('attempts[0].responseStatus: 401');
  });

  it('grounds the model call: system prompt, few-shots, a retrieval-first request, and a scoped toolkit', async () => {
    const event = await createEvent(submission);
    const client = makeStubClient();
    await investigateEvent(event.id, { client });

    const [system, ...rest] = client.lastMessages;
    expect(system?.role).toBe('system');
    expect(system?.role === 'system' && system.content).toContain('GROUNDING RULE');

    // The final turn is the investigation request: it names the event and instructs retrieval, but
    // inlines no log data (that now arrives via the tools).
    const userTurn = client.lastMessages.at(-1);
    expect(userTurn?.role).toBe('user');
    expect(userTurn?.role === 'user' && userTurn.content).toContain(`eventId: ${event.id}`);
    expect(userTurn?.role === 'user' && userTurn.content).toContain('get_delivery_history');
    expect(userTurn?.role === 'user' && userTurn.content).not.toContain(
      'attempts[0].responseStatus',
    );

    // Few-shot turns ride between system and the real request.
    expect(rest.length).toBeGreaterThan(1);

    // The service handed the client a toolkit scoped to this event (the three retrieval tools).
    expect(client.lastToolkit?.definitions.length).toBe(3);
  });
});
