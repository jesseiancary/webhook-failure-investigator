import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { prisma } from '../db/client.js';
import { seedScenarios } from '../ingest/seed.js';
import { DiagnosisSchema } from './diagnosis.schema.js';
import { hasOpenAIKey } from './openai-test-gate.js';

// The HTTP-layer twin of diagnosis.live.int.test.ts: one REAL OpenAI call, but driven through
// `POST /events/:id/investigate` so routing, status codes, and JSON serialization of the persisted
// Investigation are all exercised end to end. Gated on OPENAI_API_KEY so keyless CI skips it. This
// file does NOT mock the OpenAI seam (unlike diagnosis.routes.int.test.ts), so it must stay separate.

describe.skipIf(!hasOpenAIKey())('POST /events/:id/investigate (live OpenAI)', () => {
  beforeAll(async () => {
    await prisma.investigation.deleteMany();
    await seedScenarios();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('classifies the seeded 401 as authentication through the HTTP layer', async () => {
    const res = await request(app).post('/events/seed_stripe_auth_401/investigate').expect(201);

    const parsed = DiagnosisSchema.parse(res.body.diagnosis);
    expect(parsed.failureCategory).toBe('authentication');
    expect(
      parsed.evidence.some((e) => e.field.includes('responseStatus') && e.value.includes('401')),
    ).toBe(true);
    expect(res.body.promptTokens).toBeGreaterThan(0);
    expect(res.body.completionTokens).toBeGreaterThan(0);
  }, 30_000);
});
