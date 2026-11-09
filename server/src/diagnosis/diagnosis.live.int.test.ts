import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/client.js';
import { seedApiDocs, seedScenarios } from '../ingest/seed.js';
import { DiagnosisSchema } from './diagnosis.schema.js';
import { investigateEvent } from './diagnosis.service.js';
import { hasOpenAIKey } from './openai-test-gate.js';

// REAL OpenAI calls, gated on OPENAI_API_KEY so CI (which has no key) skips them and stays green and
// free — mirroring the "int tests need DATABASE_URL" convention. Run locally with both DATABASE_URL
// and a real OPENAI_API_KEY set to verify end-to-end that the model drives the tool-calling loop,
// grounds its diagnosis in the retrieved logs, and refuses to guess when the logs are thin. It's
// also the empirical proof that the configured OPENAI_MODEL supports the Structured Outputs response
// format AND tool calling together — an unsupported model fails these calls.

describe.skipIf(!hasOpenAIKey())('investigateEvent (live OpenAI)', () => {
  beforeAll(async () => {
    await prisma.investigation.deleteMany();
    await seedScenarios();
    await seedApiDocs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('classifies the seeded 401 as authentication and cites the 401 status', async () => {
    const investigation = await investigateEvent('seed_stripe_auth_401');
    expect(investigation).not.toBeNull();

    const parsed = DiagnosisSchema.parse(investigation?.diagnosis);
    expect(parsed.failureCategory).toBe('authentication');

    // Grounded in the real log field: some evidence item cites the 401 status.
    const citesStatus = parsed.evidence.some(
      (e) => e.field.includes('responseStatus') && e.value.includes('401'),
    );
    expect(citesStatus).toBe(true);

    // Remediation speaks to the credential/auth fix.
    expect(parsed.remediationSteps.join(' ').toLowerCase()).toMatch(
      /key|credential|token|auth|secret/,
    );

    // Accounting was recorded on the persisted row.
    expect(investigation?.promptTokens).toBeGreaterThan(0);
    expect(investigation?.completionTokens).toBeGreaterThan(0);
  }, 30_000);

  it('drives the tool-calling loop and persists the retrieval trace', async () => {
    const investigation = await investigateEvent('seed_stripe_auth_401');
    expect(investigation).not.toBeNull();

    // The model retrieved the logs through the tools: assistant tool-call rows + tool-result rows
    // were persisted (proof the loop actually ran, not a single-shot guess).
    const messages = await prisma.investigationMessage.findMany({
      where: { investigationId: investigation!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.role === 'assistant' && m.toolCalls != null)).toBe(true);
    expect(messages.some((m) => m.role === 'tool')).toBe(true);

    // Redaction holds end-to-end: no raw secret in any persisted tool result.
    for (const message of messages) {
      expect(message.content).not.toContain('sk-');
    }
  }, 30_000);

  it('refuses to guess on the thin-logs scenario (insufficient_evidence + isSpeculative)', async () => {
    const investigation = await investigateEvent('seed_stripe_insufficient_evidence');
    expect(investigation).not.toBeNull();

    const parsed = DiagnosisSchema.parse(investigation?.diagnosis);
    expect(parsed.failureCategory).toBe('insufficient_evidence');
    expect(parsed.isSpeculative).toBe(true);
  }, 30_000);
});
