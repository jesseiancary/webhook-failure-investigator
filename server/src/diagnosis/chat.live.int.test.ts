import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { prisma } from '../db/client.js';
import { seedScenarios } from '../ingest/seed.js';
import { hasOpenAIKey } from './openai-test-gate.js';

// One REAL OpenAI call through POST /investigations/:id/chat, proving grounded multi-turn Q&A end to
// end: on a seeded 401 investigation, a follow-up "why not a network issue?" must answer from the
// persisted diagnosis + delivery logs (naming the 401 / authentication / reachability), not invent a
// network fault. Gated on OPENAI_API_KEY so keyless CI skips it. Unlike chat.routes.int.test.ts this
// file does NOT mock the chat client, so it stays separate. The investigation is seeded directly (a
// canned authentication diagnosis over the real seeded event) so the test spends exactly one real
// call — on chat — rather than also paying for a live diagnosis run.

const authDiagnosis = {
  failureCategory: 'authentication',
  rootCause:
    'The receiver rejected the delivery with HTTP 401 and an api_key_expired error code — an expired credential, not a transport fault.',
  confidence: 0.96,
  evidence: [
    {
      field: 'attempts[0].responseStatus',
      value: '401',
      note: 'Rejected on authentication; the endpoint answered, so it was reachable.',
    },
    {
      field: 'attempts[0].responseBody.error.code',
      value: 'api_key_expired',
      note: 'The receiver names the expired credential as the cause.',
    },
  ],
  remediationSteps: ['Rotate the expired API key and re-send the delivery.'],
  reachabilityAssessment: 'reachable',
  isSpeculative: false,
};

describe.skipIf(!hasOpenAIKey())('POST /investigations/:id/chat (live OpenAI)', () => {
  let investigationId: string;

  beforeAll(async () => {
    await prisma.investigationMessage.deleteMany();
    await prisma.investigation.deleteMany();
    await seedScenarios();
    const investigation = await prisma.investigation.create({
      data: {
        event: { connect: { id: 'seed_stripe_auth_401' } },
        diagnosis: authDiagnosis as unknown as Prisma.InputJsonValue,
        failureCategory: 'authentication',
        confidence: 0.96,
        model: 'gpt-6-luna',
        promptVersion: 'diagnosis-v2',
        promptTokens: 1200,
        completionTokens: 300,
        costUsd: new Prisma.Decimal('0.0003'),
      },
    });
    investigationId = investigation.id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('answers a follow-up from the persisted diagnosis/log context (grounded, not invented)', async () => {
    const res = await request(app)
      .post(`/investigations/${investigationId}/chat`)
      .send({ message: 'Why not a network issue?' })
      .expect(200);

    // Reassemble the streamed answer from the SSE delta events.
    const answer = res.text
      .split('\n\n')
      .filter((block) => block.includes('event: delta'))
      .map((block) => {
        const dataLine = block.split('\n').find((l) => l.startsWith('data: '))!;
        return (JSON.parse(dataLine.slice('data: '.length)) as { text: string }).text;
      })
      .join('');

    // The answer should reference the grounded signal — the 401 / authentication / reachability —
    // rather than inventing a network failure the logs don't show.
    expect(answer.length).toBeGreaterThan(0);
    expect(/401|auth|reachab|expired|credential/i.test(answer)).toBe(true);

    // The turn persisted a grounded assistant row with accounting (CLAUDE.md rule).
    const assistant = await prisma.investigationMessage.findFirst({
      where: { investigationId, role: 'assistant' },
      orderBy: { seq: 'desc' },
    });
    expect(assistant?.content).toBe(answer);
    expect(assistant?.model).toBeTruthy();
    expect(assistant?.promptTokens ?? 0).toBeGreaterThan(0);
    expect(assistant?.completionTokens ?? 0).toBeGreaterThan(0);
  }, 30_000);
});
