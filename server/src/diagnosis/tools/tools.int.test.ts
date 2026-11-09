import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db/client.js';
import { createEvent } from '../../ingest/events.service.js';
import type { ManualSubmission } from '../../ingest/schemas.js';
import { seedApiDocs } from '../../ingest/seed.js';
import { fetchApiDocs, getDeliveryHistory, getEventPayload } from './index.js';

// Integration tests against a real Postgres (DATABASE_URL must point at a test database). The
// retrieval tools read stored data, so they're exercised against seeded rows — no OpenAI, no network.

async function resetDb(): Promise<void> {
  await prisma.investigation.deleteMany();
  await prisma.deliveryAttempt.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.captureEndpoint.deleteMany();
  await prisma.apiDoc.deleteMany();
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

// A submission carrying a raw secret, to prove the tools surface redacted data (never the secret).
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

describe('getEventPayload', () => {
  it('returns the event envelope with citable paths and no leaked secret', async () => {
    const event = await createEvent(submission);

    const block = await getEventPayload(event.id);

    expect(block).toContain('source: stripe');
    expect(block).toContain('eventType: invoice.payment_failed');
    expect(block).toContain('"id":"evt_test"');
    // Redaction holds: the raw secret never appears; the marker does.
    expect(block).not.toContain('sk-should-be-redacted');
    expect(block).toContain('[REDACTED]');
  });

  it('reports an explicit not-found for an unknown event', async () => {
    expect(await getEventPayload('does-not-exist')).toContain('No event found');
  });
});

describe('getDeliveryHistory', () => {
  it('serializes attempts with citable attempts[i].field paths', async () => {
    const event = await createEvent(submission);

    const block = await getDeliveryHistory(event.id);

    expect(block).toContain('DELIVERY HISTORY — 1 attempt(s)');
    expect(block).toContain('attempts[0].responseStatus: 401');
    expect(block).toContain('attempts[0].responseHeaders:');
    expect(block).not.toContain('sk-should-be-redacted');
  });

  it('renders zero attempts for an unknown event (a thin-logs signal)', async () => {
    expect(await getDeliveryHistory('does-not-exist')).toContain('0 attempt(s)');
  });
});

describe('fetchApiDocs', () => {
  it('retrieves the signature section for a keyword query', async () => {
    await seedApiDocs();

    const block = await fetchApiDocs('stripe', 'signature verification');

    expect(block).toContain('Signature verification');
    expect(block).toContain('Stripe-Signature');
    expect(block).toContain('[stripe › Signature verification]');
  });

  it('explains when a provider has no docs', async () => {
    await seedApiDocs();
    expect(await fetchApiDocs('unknown-provider', 'signature')).toContain('No API reference docs');
  });

  it('explains when nothing matches the query', async () => {
    await seedApiDocs();
    expect(await fetchApiDocs('stripe', 'zzzznomatch')).toContain('matched the query');
  });
});
