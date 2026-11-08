import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/client.js';
import { getEventById } from './events.service.js';
import { REDACTED } from './redact.js';
import { scenarios } from './scenarios/index.js';
import { seedScenarios } from './seed.js';

// Integration tests against a real Postgres (DATABASE_URL must point at a test database). Verifies
// the loader persists the whole library, is idempotent, and redacts secrets on load.

async function resetDb(): Promise<void> {
  await prisma.deliveryAttempt.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.captureEndpoint.deleteMany();
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('seedScenarios', () => {
  it('persists every scenario and is idempotent across re-runs', async () => {
    const first = await seedScenarios();
    expect(first.created).toBe(scenarios.length);
    expect(await prisma.webhookEvent.count()).toBe(scenarios.length);

    // Re-running clears its own seed_* rows and re-inserts — no duplicates.
    await seedScenarios();
    expect(await prisma.webhookEvent.count()).toBe(scenarios.length);
  });

  it('redacts a body secret on load (client_secret → [REDACTED])', async () => {
    await seedScenarios();
    const event = await getEventById('seed_slack_payload_secret_redacted');
    expect(event).not.toBeNull();

    const payload = event?.payload as Record<string, unknown>;
    expect(payload.client_secret).toBe(REDACTED);

    const requestBody = event?.attempts[0]?.requestBody as Record<string, unknown>;
    expect(requestBody.client_secret).toBe(REDACTED);
    // Non-secret evidence is preserved.
    expect(requestBody.code).toBe('valid-but-expired');
  });

  it('stores each scenario under its stable key with its grounding evidence intact', async () => {
    await seedScenarios();
    const auth = await getEventById('seed_stripe_auth_401');
    expect(auth?.source).toBe('stripe');
    expect(auth?.attempts[0]?.responseStatus).toBe(401);

    // Secret request headers are redacted even on the seeded path.
    const headers = auth?.attempts[0]?.requestHeaders as Record<string, unknown>;
    expect(headers.authorization).toBe(REDACTED);
    expect(headers['stripe-signature']).toBe(REDACTED);
  });
});
