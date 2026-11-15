import { scenarios } from '../ingest/scenarios/index.js';
import type { Scenario } from '../ingest/scenarios/index.js';

// The eval's single source of ground truth. Phase 3 already attached `expected.category` +
// `expected.evidence[]` to each seed scenario (scenarios/types.ts); the harness reads those labels
// directly from the in-memory library rather than inventing a parallel label format or a DB table
// (they are deliberately not persisted — Investigation holds model output, not truth). This thin
// module is the one place the rest of the eval imports the labeled set from.

export { scenarios };
export type { Scenario };

/** The labeled scenarios the harness scores against (every seed scenario carries ground truth). */
export function labeledScenarios(): Scenario[] {
  return scenarios;
}
