import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/client.js';
import { seedScenarios } from '../ingest/seed.js';
import { DiagnosisSchema } from './diagnosis.schema.js';
import { investigateEvent } from './diagnosis.service.js';

// A single REAL OpenAI call, gated on OPENAI_API_KEY so CI (which has no key) skips it and stays
// green and free — mirroring the "int tests need DATABASE_URL" convention. Run locally with both
// DATABASE_URL and a real OPENAI_API_KEY set to verify end-to-end classification and grounding
// against the live model. It's also the empirical proof that the configured OPENAI_MODEL actually
// supports the Structured Outputs response format we send — an unsupported model fails this call.

// The `.env.example` placeholder counts as "no key": config/env loads .env into process.env, so a
// developer who copied the example but never pasted a real key must still get a clean skip — not a
// real call that fails on a bogus credential.
const PLACEHOLDER_KEY = 'sk-your-key-here';
const key = process.env.OPENAI_API_KEY;
const hasKey = key != null && key !== '' && key !== PLACEHOLDER_KEY;

describe.skipIf(!hasKey)('investigateEvent (live OpenAI)', () => {
  beforeAll(async () => {
    await prisma.investigation.deleteMany();
    await seedScenarios();
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
});
