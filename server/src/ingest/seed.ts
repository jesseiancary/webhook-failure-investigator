import { prisma } from '../db/client.js';
import { apiDocs } from './api-docs/index.js';
import { createEvent } from './events.service.js';
import { scenarios } from './scenarios/index.js';

// The seed loader. Lives under src/ (typechecked + unit-testable); prisma/seed.ts is the thin CLI
// entry that calls it. Idempotent and non-destructive: it clears only the `seed_`-prefixed events
// it owns (attempts cascade) and re-inserts, so live/captured events are never touched. Every
// scenario is persisted through createEvent — the single redaction choke point — so seeded data is
// redacted on write exactly like manual submissions and live captures.

/** Namespace for seeded event ids, so re-seeding can clear its own rows without touching others. */
export const SEED_ID_PREFIX = 'seed_';

/** Namespace for seeded ApiDoc ids, so re-seeding clears its own reference docs and nothing else. */
export const API_DOC_ID_PREFIX = 'doc_';

/**
 * Load the labeled scenario library into the database. Returns how many scenarios were seeded.
 * Safe to run repeatedly: existing `seed_*` events are removed first, then all scenarios inserted.
 */
export async function seedScenarios(): Promise<{ created: number }> {
  await prisma.webhookEvent.deleteMany({ where: { id: { startsWith: SEED_ID_PREFIX } } });

  for (const scenario of scenarios) {
    await createEvent(scenario.submission, { id: scenario.key });
  }

  return { created: scenarios.length };
}

/**
 * Load the provider reference-doc corpus retrieved by `fetch_api_docs`. Returns how many docs were
 * seeded. Idempotent like `seedScenarios`: existing `doc_*` rows are cleared first, then re-inserted
 * under their stable ids. These are public, secret-free API facts — grounding for the model's
 * explanation and remediation, never delivery-log evidence.
 */
export async function seedApiDocs(): Promise<{ created: number }> {
  await prisma.apiDoc.deleteMany({ where: { id: { startsWith: API_DOC_ID_PREFIX } } });

  await prisma.apiDoc.createMany({
    data: apiDocs.map((doc) => ({
      id: doc.id,
      provider: doc.provider,
      section: doc.section,
      content: doc.content,
    })),
  });

  return { created: apiDocs.length };
}
