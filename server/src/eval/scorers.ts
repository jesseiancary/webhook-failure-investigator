import { FAILURE_CATEGORIES, type FailureCategoryValue } from '../domain/failure-category.js';
import type { Diagnosis } from '../diagnosis/diagnosis.schema.js';
import { scoreGrounding } from './grounding.js';
import type {
  CategoryBreakdown,
  ConfidenceBucket,
  Scorecard,
  ScoredInput,
  ScenarioResult,
} from './types.js';

// The quality scorers. Pure functions over (labeled scenario -> produced diagnosis): classification
// accuracy, grounding pass rate (grounding.ts), and confidence calibration. No I/O, no DB — PR2's CLI
// turns a Scorecard into a rendered + exported report; the harness's "teeth" are proven by feeding
// these functions canned correct and canned regressed diagnoses (scorers.test.ts).

// Confidence bands. A clear-cut scenario should land high and non-speculative; a genuinely ambiguous
// one (the insufficient_evidence seed) should stay below `HIGH` and be flagged speculative. These are
// the calibration expectations, not hard schema bounds.
const HIGH_CONFIDENCE = 0.7;
const LOW_CONFIDENCE = 0.5;

function bucketConfidence(confidence: number): ConfidenceBucket {
  if (confidence >= HIGH_CONFIDENCE) return 'high';
  if (confidence < LOW_CONFIDENCE) return 'low';
  return 'medium';
}

/**
 * Is the confidence/speculation appropriate for how clear-cut the scenario is? The ambiguous
 * `insufficient_evidence` seeds should not be asserted with high confidence and should be flagged
 * speculative; every other (clear-cut) scenario should be confident and non-speculative. Returns the
 * check plus a note naming the miscalibration when it fails.
 */
function scoreCalibration(
  expectedCategory: FailureCategoryValue,
  diagnosis: Diagnosis,
): { ok: boolean; note?: string } {
  if (expectedCategory === 'insufficient_evidence') {
    if (diagnosis.confidence >= HIGH_CONFIDENCE) {
      return { ok: false, note: 'overconfident on an ambiguous case' };
    }
    if (!diagnosis.isSpeculative) {
      return { ok: false, note: 'not flagged speculative on an ambiguous case' };
    }
    return { ok: true };
  }

  if (diagnosis.confidence < HIGH_CONFIDENCE) {
    return { ok: false, note: 'underconfident on a clear-cut case' };
  }
  if (diagnosis.isSpeculative) {
    return { ok: false, note: 'flagged speculative on a clear-cut case' };
  }
  return { ok: true };
}

// A scored scenario plus the diagnostic strings (grounding reason, calibration note) the scorecard's
// failure/mismatch lists need. Computed once per scenario so no scorer runs twice.
interface EnrichedResult {
  result: ScenarioResult;
  groundingReason?: string;
  calibrationNote?: string;
}

function scoreOne({ scenario, diagnosis }: ScoredInput): EnrichedResult {
  const expectedCategory = scenario.expected.category;
  const predictedCategory = diagnosis.failureCategory;
  const grounding = scoreGrounding(scenario, diagnosis);
  const calibration = scoreCalibration(expectedCategory, diagnosis);

  return {
    result: {
      key: scenario.key,
      description: scenario.description,
      expectedCategory,
      predictedCategory,
      classificationCorrect: predictedCategory === expectedCategory,
      grounded: grounding.grounded,
      groundingCoverage: grounding.coverage,
      hallucinatedFields: grounding.hallucinatedFields,
      confidence: diagnosis.confidence,
      confidenceBucket: bucketConfidence(diagnosis.confidence),
      isSpeculative: diagnosis.isSpeculative,
      calibrationOk: calibration.ok,
    },
    groundingReason: grounding.reason,
    calibrationNote: calibration.note,
  };
}

function perCategory(results: ScenarioResult[]): CategoryBreakdown[] {
  return FAILURE_CATEGORIES.map((category) => {
    const forCategory = results.filter((result) => result.expectedCategory === category);
    return {
      category,
      total: forCategory.length,
      correct: forCategory.filter((result) => result.classificationCorrect).length,
    };
  }).filter((breakdown) => breakdown.total > 0);
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

/**
 * Score a set of (scenario, diagnosis) pairs into a compact Scorecard: overall + per-category
 * classification accuracy, grounding pass rate with named failures, and confidence calibration with
 * named mismatches. Pure — the same inputs always produce the same scorecard.
 */
export function scoreScenarios(inputs: ScoredInput[]): Scorecard {
  const enriched = inputs.map(scoreOne);
  const results = enriched.map((entry) => entry.result);
  const total = results.length;

  const classificationCorrect = results.filter((result) => result.classificationCorrect).length;
  const groundingPassed = results.filter((result) => result.grounded).length;
  const calibrationOk = results.filter((result) => result.calibrationOk).length;
  // Coverage is a field-citation metric, so average it over the field scenarios only; the refusal
  // (insufficient_evidence) scenarios report their own pass/fail tally instead of a 0/1 coverage that
  // would otherwise distort the mean.
  const coverageResults = results.filter(
    (result) => result.expectedCategory !== 'insufficient_evidence',
  );
  const meanCoverage =
    coverageResults.length === 0
      ? 0
      : coverageResults.reduce((sum, result) => sum + result.groundingCoverage, 0) /
        coverageResults.length;

  const refusalResults = results.filter(
    (result) => result.expectedCategory === 'insufficient_evidence',
  );
  const refusals = {
    total: refusalResults.length,
    correct: refusalResults.filter((result) => result.grounded).length,
  };

  return {
    total,
    classification: {
      correct: classificationCorrect,
      accuracy: rate(classificationCorrect, total),
      perCategory: perCategory(results),
      misclassified: results
        .filter((result) => !result.classificationCorrect)
        .map((result) => ({
          key: result.key,
          expected: result.expectedCategory,
          predicted: result.predictedCategory,
        })),
    },
    grounding: {
      passed: groundingPassed,
      passRate: rate(groundingPassed, total),
      meanCoverage,
      refusals,
      failures: enriched
        .filter((entry) => !entry.result.grounded)
        .map((entry) => ({
          key: entry.result.key,
          reason: entry.groundingReason ?? 'not grounded',
        })),
    },
    calibration: {
      ok: calibrationOk,
      okRate: rate(calibrationOk, total),
      mismatches: enriched
        .filter((entry) => !entry.result.calibrationOk)
        .map((entry) => ({
          key: entry.result.key,
          note: entry.calibrationNote ?? 'miscalibrated',
        })),
    },
    scenarios: results,
  };
}
