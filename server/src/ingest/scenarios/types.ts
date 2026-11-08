import type { FailureCategoryValue } from '../../domain/failure-category.js';
import type { ManualSubmission } from '../schemas.js';

// A labeled, seedable failure scenario. `submission` is loaded through the same redaction choke
// point as any other ingest (events.service.createEvent); `expected` is the ground-truth label the
// Phase 8 eval harness scores diagnoses against — it is deliberately NOT persisted (there's no
// ground-truth table; Investigation holds LLM output, not truth). Secret-bearing request/header
// values are authored pre-redacted so the fixture files stay free of raw secrets (the
// secret-redaction-guard scans this directory); createEvent still re-redacts defensively on load.

export interface Scenario {
  /** Stable, `seed_`-prefixed id used as the WebhookEvent id for idempotent re-seeding. */
  key: string;
  /** One-line human summary of what this scenario demonstrates. */
  description: string;
  /** The event + delivery attempts to persist (redacted on write by createEvent). */
  submission: ManualSubmission;
  /** Ground truth for evals: the correct category and the real log fields a diagnosis must cite. */
  expected: {
    category: FailureCategoryValue;
    evidence: string[];
  };
}
