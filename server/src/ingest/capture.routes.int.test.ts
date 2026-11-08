import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { prisma } from '../db/client.js';
import { REDACTED } from './redact.js';

// Integration tests against a real Postgres (DATABASE_URL must point at a test database). Manages
// its own lifecycle so the DB-free unit tests stay database-free.

async function resetDb(): Promise<void> {
  await prisma.deliveryAttempt.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.captureEndpoint.deleteMany();
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

async function mintEndpoint(body: Record<string, unknown> = {}): Promise<string> {
  const created = await request(app).post('/capture-endpoints').send(body).expect(201);
  return created.body.token as string;
}

describe('POST /capture-endpoints', () => {
  it('mints an endpoint and returns its token once', async () => {
    const created = await request(app)
      .post('/capture-endpoints')
      .send({ source: 'stripe' })
      .expect(201);
    expect(created.body.token).toBeTruthy();
    expect(created.body.source).toBe('stripe');
  });
});

describe('GET /capture-endpoints', () => {
  it('lists endpoints with an event count but without their tokens', async () => {
    await mintEndpoint({ source: 'stripe', name: 'Stripe test' });
    const list = await request(app).get('/capture-endpoints').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].source).toBe('stripe');
    expect(list.body[0]._count.events).toBe(0);
    // The capture token is a secret — it must never appear in the list.
    expect(list.body[0]).not.toHaveProperty('token');
  });
});

describe('POST /capture/:token', () => {
  it('records an inbound webhook with secrets redacted and the source inferred', async () => {
    const token = await mintEndpoint({ source: 'stripe' });

    const captured = await request(app)
      .post(`/capture/${token}`)
      .set('Stripe-Signature', 't=1,v1=deadbeef')
      .set('Authorization', 'Bearer sk-live-supersecret')
      .send({ type: 'invoice.payment_failed', data: { password: 'hunter2', amount: 4200 } })
      .expect(202);

    const id = captured.body.id as string;
    expect(id).toBeTruthy();

    const fetched = await request(app).get(`/events/${id}`).expect(200);
    expect(fetched.body.source).toBe('stripe');
    expect(fetched.body.eventType).toBe('invoice.payment_failed');

    // Secrets redacted at persistence; evidence preserved. HTTP header names arrive lowercased.
    const attempt = fetched.body.attempts[0];
    expect(attempt.requestHeaders['stripe-signature']).toBe(REDACTED);
    expect(attempt.requestHeaders.authorization).toBe(REDACTED);
    expect(attempt.requestBody.data.password).toBe(REDACTED);
    expect(attempt.requestBody.data.amount).toBe(4200);
    expect(attempt.responseStatus).toBe(202);
    // The stored URL keeps the route shape but not the secret token.
    expect(attempt.requestUrl).toBe('/capture/:token');

    // The secret token must not leak through the event detail response.
    expect(JSON.stringify(fetched.body)).not.toContain(token);
  });

  it('returns 404 for an unknown token', async () => {
    await request(app).post('/capture/does-not-exist').send({ type: 'x' }).expect(404);
  });
});
