import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app.js';
import { prisma } from '../db/client.js';
import { createEvent } from '../ingest/events.service.js';
import { DiagnosisSchema, type Diagnosis } from './diagnosis.schema.js';
import { PROMPT_VERSION } from './prompt.js';

// Integration tests against a real Postgres (DATABASE_URL must point at a test database), exercising
// the HTTP layer → service → persistence path. The only thing stubbed is the OpenAI network call:
// we mock the `createOpenAIDiagnosisClient` factory so the route's default (no-arg) call returns a
// deterministic diagnosis. That keeps these tests free and offline while still proving the real
// wiring — routing, 404 mapping, column hoisting, cost accounting. The key-gated real-call path
// through HTTP lives in diagnosis.routes.live.int.test.ts.

// `vi.mock` is hoisted above the imports, so its factory can't close over a normal top-level const
// (that would be a temporal-dead-zone error). `vi.hoisted` lifts the canned diagnosis alongside it
// so the factory and the test body share one value.
const { cannedDiagnosis } = vi.hoisted(() => ({
  cannedDiagnosis: {
    failureCategory: 'authentication',
    rootCause: 'Rejected with 401 and an expired-key error code.',
    confidence: 0.96,
    evidence: [{ field: 'attempts[0].responseStatus', value: '401', note: 'Unauthorized.' }],
    remediationSteps: ['Rotate the API key.'],
    reachabilityAssessment: 'reachable',
    isSpeculative: false,
  } satisfies Diagnosis,
}));

vi.mock('./openai.js', () => ({
  createOpenAIDiagnosisClient: () => ({
    async runDiagnosis() {
      return {
        diagnosis: cannedDiagnosis,
        usage: { promptTokens: 1200, completionTokens: 300 },
        model: 'gpt-4o-2024-08-06',
        toolCalls: [],
      };
    },
  }),
}));

async function resetDb(): Promise<void> {
  await prisma.investigation.deleteMany();
  await prisma.deliveryAttempt.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.captureEndpoint.deleteMany();
}

const submission = {
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
      responseBody: { error: { code: 'api_key_expired' } },
      latencyMs: 120,
    },
  ],
};

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /events/:id/investigate', () => {
  it('returns 201 with a grounded diagnosis and accounting for a known event', async () => {
    const event = await createEvent(submission);

    const res = await request(app).post(`/events/${event.id}/investigate`).expect(201);

    // The response body is a persisted Investigation row whose diagnosis Json honours the contract.
    expect(DiagnosisSchema.safeParse(res.body.diagnosis).success).toBe(true);
    expect(res.body.eventId).toBe(event.id);
    expect(res.body.failureCategory).toBe('authentication');
    // Accounting (CLAUDE.md rule) is present on the row the route returns.
    expect(res.body.model).toBe('gpt-4o-2024-08-06');
    expect(res.body.promptVersion).toBe(PROMPT_VERSION);
    expect(res.body.promptTokens).toBe(1200);
    expect(res.body.completionTokens).toBe(300);
  });

  it('persists the investigation (readable back via the list endpoint)', async () => {
    const event = await createEvent(submission);
    await request(app).post(`/events/${event.id}/investigate`).expect(201);

    const list = await request(app).get(`/events/${event.id}/investigations`).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].failureCategory).toBe('authentication');
  });

  it('returns 404 for an unknown event', async () => {
    await request(app).post('/events/does-not-exist/investigate').expect(404);
  });
});

describe('GET /events/:id/investigations', () => {
  it('lists prior runs newest-first', async () => {
    const event = await createEvent(submission);
    await request(app).post(`/events/${event.id}/investigate`).expect(201);
    await request(app).post(`/events/${event.id}/investigate`).expect(201);

    const list = await request(app).get(`/events/${event.id}/investigations`).expect(200);
    expect(list.body).toHaveLength(2);
    const [first, second] = list.body;
    expect(new Date(first.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(second.createdAt).getTime(),
    );
  });

  it('returns an empty array for an existing event with no investigations', async () => {
    const event = await createEvent(submission);
    const list = await request(app).get(`/events/${event.id}/investigations`).expect(200);
    expect(list.body).toEqual([]);
  });

  it('projects a summary: category/confidence/model/cost, but not the full diagnosis blob', async () => {
    const event = await createEvent(submission);
    await request(app).post(`/events/${event.id}/investigate`).expect(201);

    const list = await request(app).get(`/events/${event.id}/investigations`).expect(200);
    const [row] = list.body;
    expect(row).toMatchObject({ failureCategory: 'authentication', model: 'gpt-4o-2024-08-06' });
    expect(row.id).toBeTruthy();
    expect(typeof row.confidence).toBe('number');
    expect(row.costUsd).toBeDefined();
    // The heavy diagnosis Json stays out of the list — it loads per-investigation on the detail view.
    expect(row).not.toHaveProperty('diagnosis');
  });

  it('returns 404 for an unknown event', async () => {
    await request(app).get('/events/does-not-exist/investigations').expect(404);
  });
});

describe('GET /investigations/:id', () => {
  it('returns the investigation with its event, delivery attempts, and message thread', async () => {
    const event = await createEvent(submission);
    const created = await request(app).post(`/events/${event.id}/investigate`).expect(201);

    const res = await request(app).get(`/investigations/${created.body.id}`).expect(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.failureCategory).toBe('authentication');
    expect(DiagnosisSchema.safeParse(res.body.diagnosis).success).toBe(true);
    // The event it diagnosed, with its (redacted) attempts, so the detail view can show both.
    expect(res.body.event.id).toBe(event.id);
    expect(res.body.event.attempts).toHaveLength(1);
    // The message thread is present (empty here — the canned stub makes no tool calls).
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it('returns 404 for an unknown investigation', async () => {
    await request(app).get('/investigations/does-not-exist').expect(404);
  });
});

describe('GET /events reflects the latest investigation', () => {
  it('populates latestInvestigation on the summary list after a run', async () => {
    const event = await createEvent(submission);
    await request(app).post(`/events/${event.id}/investigate`).expect(201);

    const list = await request(app).get('/events').expect(200);
    const row = list.body.find((e: { id: string }) => e.id === event.id);
    expect(row.latestInvestigation).toMatchObject({ failureCategory: 'authentication' });
    expect(row.primaryResponseStatus).toBe(401);
  });
});
