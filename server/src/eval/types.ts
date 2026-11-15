import type { FailureCategoryValue } from '../domain/failure-category.js';
import type { Diagnosis } from '../diagnosis/diagnosis.schema.js';
import type { Scenario } from '../ingest/scenarios/index.js';

// The data the eval scorers operate on, and the scorecard they produce. Kept free of any I/O or
// formatting (PR2's CLI owns rendering/export) and free of the DB (PR1's runner owns persistence),
// so the scoring logic is a pure function of (labeled scenario -> produced diagnosis) and can be
// unit-tested with canned diagnoses — no model, no network, no Postgres.

/** One labeled scenario paired with the diagnosis a run produced for it. The unit the scorers score. */
export interface ScoredInput {
  scenario: Scenario;
  diagnosis: Diagnosis;
}

/** Coarse confidence band, for at-a-glance reporting. */
export type ConfidenceBucket = 'high' | 'medium' | 'low';

/** The full per-scenario scoring breakdown — rich enough for `prompt-evaluator` to name each failure. */
export interface ScenarioResult {
  key: string;
  description: string;
  expectedCategory: FailureCategoryValue;
  predictedCategory: FailureCategoryValue;
  /** predicted === expected. */
  classificationCorrect: boolean;
  /** Does the diagnosis cite the expected log evidence (or correctly refuse, for insufficient_evidence)? */
  grounded: boolean;
  /** Fraction of the scenario's expected evidence items the diagnosis cited (0–1). */
  groundingCoverage: number;
  /** Cited `evidence[].field` paths that don't resolve to a real serialized log field. */
  hallucinatedFields: string[];
  confidence: number;
  confidenceBucket: ConfidenceBucket;
  isSpeculative: boolean;
  /** Is the confidence/speculation appropriate for how clear-cut the scenario is? */
  calibrationOk: boolean;
}

/** Per-category classification tally (how many of each expected category were predicted correctly). */
export interface CategoryBreakdown {
  category: FailureCategoryValue;
  total: number;
  correct: number;
}

/** The compact, diffable quality scorecard for one eval run (one prompt version against the seed set). */
export interface Scorecard {
  total: number;
  classification: {
    correct: number;
    accuracy: number;
    perCategory: CategoryBreakdown[];
    misclassified: {
      key: string;
      expected: FailureCategoryValue;
      predicted: FailureCategoryValue;
    }[];
  };
  grounding: {
    passed: number;
    passRate: number;
    /** Mean field-coverage over the field-citation scenarios only (excludes refusal scenarios). */
    meanCoverage: number;
    /** The insufficient_evidence refusal scenarios: how many, and how many refused correctly. */
    refusals: { total: number; correct: number };
    failures: { key: string; reason: string }[];
  };
  calibration: {
    ok: number;
    okRate: number;
    mismatches: { key: string; note: string }[];
  };
  scenarios: ScenarioResult[];
}
