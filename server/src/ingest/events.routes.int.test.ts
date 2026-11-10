import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { prisma } from '../db/client.js';
import { REDACTED } from './redact.js';

// Integration tests against a real Postgres (DATABASE_URL must point at a test database).
// This is the only test file that touches the DB; it manages its own lifecycle so the
// redaction/schema unit tests stay database-free.

async function resetDb(): Promise<void> {
  // Delete children before parents (cascade also covers this, but be explicit).
  await prisma.deliveryAttempt.deleteMany();
  await prisma.webhookEvent.deleteMany();
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

const submission = {
  source: 'stripe',
  eventType: 'invoice.payment_failed',
  payload: { id: 'evt_123', object: 'event' },
  headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=deadbeef' },
  attempts: [
    {
      requestUrl: 'https://api.example.com/webhooks/stripe',
      requestMethod: 'POST',
      requestHeaders: { Authorization: 'Bearer sk-live-supersecret', 'User-Agent': 'Stripe/1.0' },
      requestBody: { apiVersion: '2020-08-27', password: 'hunter2' },
      responseStatus: 401,
      responseHeaders: { 'WWW-Authenticate': 'Bearer' },
      responseBody: { error: 'invalid_token' },
      latencyMs: 142,
    },
  ],
};

describe('POST /events', () => {
  it('persists a submission with secrets redacted (the Phase 3 gate)', async () => {
    const created = await request(app).post('/events').send(submission).expect(201);
    const id = created.body.id as string;
    expect(id).toBeTruthy();

    // Read it back fresh to prove redaction happened at persistence, not just in the echo.
    const fetched = await request(app).get(`/events/${id}`).expect(200);

    // Event-level secret header redacted; benign header preserved.
    expect(fetched.body.headers['Stripe-Signature']).toBe(REDACTED);
    expect(fetched.body.headers['Content-Type']).toBe('application/json');

    const attempt = fetched.body.attempts[0];
    // Request secrets redacted, non-secrets intact.
    expect(attempt.requestHeaders.Authorization).toBe(REDACTED);
    expect(attempt.requestHeaders['User-Agent']).toBe('Stripe/1.0');
    expect(attempt.requestBody.password).toBe(REDACTED);
    expect(attempt.requestBody.apiVersion).toBe('2020-08-27');
    // Evidence the diagnosis will need survives.
    expect(attempt.responseStatus).toBe(401);
    expect(attempt.responseBody.error).toBe('invalid_token');
  });

  it('rejects an invalid submission with 400', async () => {
    await request(app).post('/events').send({ source: 'stripe' }).expect(400);
  });

  it('rejects a malformed JSON body with 400, not 500', async () => {
    await request(app)
      .post('/events')
      .set('Content-Type', 'application/json')
      .send('{"source": ') // deliberately broken JSON
      .expect(400);
  });

  it('accepts an explicit null request body and stores it as absent', async () => {
    const withNullBody = {
      ...submission,
      attempts: [{ ...submission.attempts[0], requestBody: null }],
    };
    const created = await request(app).post('/events').send(withNullBody).expect(201);
    const fetched = await request(app).get(`/events/${created.body.id}`).expect(200);
    expect(fetched.body.attempts[0].requestBody).toBeNull();
  });
});

describe('GET /events', () => {
  it('lists created events with summary fields for the dashboard', async () => {
    await request(app).post('/events').send(submission).expect(201);
    const list = await request(app).get('/events').expect(200);
    expect(list.body).toHaveLength(1);
    const [row] = list.body;
    expect(row.source).toBe('stripe');
    expect(row.attemptCount).toBe(1);
    // Failure-biased status for the HTTP-status filter (single attempt here → its own status).
    expect(row.primaryResponseStatus).toBe(401);
    // Not yet investigated → null (drives the investigated-state filter + category badge).
    expect(row.latestInvestigation).toBeNull();
    // The summary stays lean: no bodies, no capture secret.
    expect(row).not.toHaveProperty('captureToken');
    expect(row).not.toHaveProperty('attempts');
    expect(row).not.toHaveProperty('payload');
  });

  it('reports the failure status for a multi-attempt event regardless of attempt order', async () => {
    // Two attempts, no explicit attemptedAt → they share the default transaction timestamp, so a
    // "most recent attempt" rule would tie non-deterministically. The failure-biased max must still
    // deterministically surface the 429 even though the terminal attempt succeeded with 200.
    const retried = {
      ...submission,
      attempts: [
        { ...submission.attempts[0], responseStatus: 429 },
        { ...submission.attempts[0], responseStatus: 200 },
      ],
    };
    await request(app).post('/events').send(retried).expect(201);

    const list = await request(app).get('/events').expect(200);
    expect(list.body).toHaveLength(1);
    const [row] = list.body;
    expect(row.attemptCount).toBe(2);
    expect(row.primaryResponseStatus).toBe(429);
  });

  it('returns 404 for an unknown event', async () => {
    await request(app).get('/events/does-not-exist').expect(404);
  });
});
