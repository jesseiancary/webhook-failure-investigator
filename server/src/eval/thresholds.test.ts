import { describe, expect, it } from 'vitest';
import type { Scorecard } from './types.js';
import { checkThresholds, type EvalThresholds } from './thresholds.js';

// Pure unit tests for the quality gate. No DB, no model: feed canned scorecards (only the two fields
// the gate reads need be realistic) and assert the pass/fail verdict. This is why `--check` can
// enforce a bar without ever spending — the math is proven here for free. The env-override parsing
// (WFI_EVAL_MIN_*) is validated in config/env.test.ts, where those getters now live.

/** A minimal Scorecard carrying just the accuracy + grounding pass rate the threshold check reads. */
function scorecard(accuracy: number, passRate: number): Scorecard {
  return {
    total: 10,
    classification: { correct: 0, accuracy, perCategory: [], misclassified: [] },
    grounding: {
      passed: 0,
      passRate,
      meanCoverage: 0,
      refusals: { total: 0, correct: 0 },
      failures: [],
    },
    calibration: { ok: 0, okRate: 0, mismatches: [] },
    scenarios: [],
  };
}

const THRESHOLDS: EvalThresholds = { minAccuracy: 0.8, minGroundingPassRate: 0.8 };

describe('checkThresholds', () => {
  it('passes when both metrics meet the bar (inclusive)', () => {
    const result = checkThresholds(scorecard(0.8, 0.9), THRESHOLDS);
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.ok)).toBe(true);
  });

  it('fails and names the metric below the bar', () => {
    const result = checkThresholds(scorecard(0.9, 0.5), THRESHOLDS);
    expect(result.passed).toBe(false);
    const grounding = result.checks.find((c) => c.name === 'grounding pass rate');
    expect(grounding?.ok).toBe(false);
    expect(grounding?.actual).toBe(0.5);
    const accuracy = result.checks.find((c) => c.name === 'classification accuracy');
    expect(accuracy?.ok).toBe(true);
  });

  it('fails when accuracy is below the bar', () => {
    expect(checkThresholds(scorecard(0.7, 1), THRESHOLDS).passed).toBe(false);
  });
});
