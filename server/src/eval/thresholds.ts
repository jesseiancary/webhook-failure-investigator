import type { Scorecard } from './types.js';

// The quality bar (Phase 8 PR3). `pnpm eval --check` turns a Scorecard into a pass/fail so the harness
// can *gate* on quality, not just report it — the `eval-threshold` gate catalogued in planned-ci.md.
// Kept pure (a function of Scorecard + thresholds) so it's unit-tested for free against canned
// scorecards; only a real `pnpm eval` run (a human opting in with a key) ever feeds it live numbers.
// A fake-mode run is plumbing, so the CLI never enforces thresholds against the canned fake diagnosis.

/** The minimum classification accuracy and grounding pass rate a real run must clear (each in [0,1]). */
export interface EvalThresholds {
  minAccuracy: number;
  minGroundingPassRate: number;
}

/**
 * The default bar. Overridable per run via `env.EVAL_MIN_ACCURACY` / `env.EVAL_MIN_GROUNDING`
 * (`WFI_EVAL_MIN_*`, validated in config/env.ts), so it can be tuned without a code change.
 */
export const DEFAULT_THRESHOLDS: EvalThresholds = {
  minAccuracy: 0.8,
  minGroundingPassRate: 0.8,
};

/** One metric's pass/fail against its floor, carrying the numbers for a legible report line. */
export interface ThresholdCheck {
  name: string;
  actual: number;
  min: number;
  ok: boolean;
}

/** The overall verdict: every metric's check, and whether all passed. */
export interface ThresholdResult {
  passed: boolean;
  checks: ThresholdCheck[];
}

/** Check a scorecard's accuracy and grounding pass rate against the thresholds. Pure. */
export function checkThresholds(scorecard: Scorecard, thresholds: EvalThresholds): ThresholdResult {
  const checks: ThresholdCheck[] = [
    {
      name: 'classification accuracy',
      actual: scorecard.classification.accuracy,
      min: thresholds.minAccuracy,
      ok: scorecard.classification.accuracy >= thresholds.minAccuracy,
    },
    {
      name: 'grounding pass rate',
      actual: scorecard.grounding.passRate,
      min: thresholds.minGroundingPassRate,
      ok: scorecard.grounding.passRate >= thresholds.minGroundingPassRate,
    },
  ];
  return { passed: checks.every((check) => check.ok), checks };
}
