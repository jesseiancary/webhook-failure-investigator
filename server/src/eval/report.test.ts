import { describe, expect, it } from 'vitest';
import type { Diagnosis } from '../diagnosis/diagnosis.schema.js';
import { scenarios } from '../ingest/scenarios/index.js';
import type { Scenario } from '../ingest/scenarios/index.js';
import { buildReport, renderMarkdown, reportFileStem } from './report.js';
import { scoreScenarios } from './scorers.js';
import type { EvalResult, EvalRun } from './runner.js';

// Deterministic unit tests for the exporter: no DB, no model. Build a scored EvalResult from canned
// runs/diagnoses, then assert the report aggregates accounting correctly and the Markdown/filename
// render stably. The scoring itself is proven in scorers.test.ts; this only covers aggregation + render.

function scenario(key: string): Scenario {
  const found = scenarios.find((s) => s.key === key);
  if (!found) throw new Error(`fixture scenario ${key} not found`);
  return found;
}

const AUTH: Diagnosis = {
  failureCategory: 'authentication',
  rootCause: 'Rejected with 401.',
  confidence: 0.95,
  evidence: [{ field: 'attempts[0].responseStatus', value: '401', note: 'Unauthorized.' }],
  remediationSteps: ['Rotate the key.'],
  reachabilityAssessment: 'reachable',
  isSpeculative: false,
};

const RATE: Diagnosis = {
  failureCategory: 'rate_limit',
  rootCause: 'Throttled with 429.',
  confidence: 0.9,
  evidence: [{ field: 'attempts[0].responseStatus', value: '429', note: 'Too many requests.' }],
  remediationSteps: ['Back off.'],
  reachabilityAssessment: 'reachable',
  isSpeculative: false,
};

function run(key: string, diagnosis: Diagnosis, overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    key,
    diagnosis,
    model: 'gpt-6-luna',
    promptVersion: 'diagnosis-v2',
    promptTokens: 1000,
    completionTokens: 200,
    costUsd: '0.000200',
    ...overrides,
  };
}

function result(): EvalResult {
  const runs: EvalRun[] = [
    run('seed_stripe_auth_401', AUTH),
    run('seed_github_rate_limit_429', RATE, {
      promptTokens: 1500,
      completionTokens: 300,
      costUsd: '0.000300',
    }),
  ];
  const scorecard = scoreScenarios(
    runs.map((r) => ({ scenario: scenario(r.key), diagnosis: r.diagnosis })),
  );
  return { runs, scorecard };
}

const META = {
  label: 'diagnosis-v2',
  generatedAt: '2026-11-15T10:30:00.000Z',
  mode: 'real' as const,
};

describe('buildReport', () => {
  it('sums token/cost accounting across runs and records the models', () => {
    const report = buildReport(result(), META);
    expect(report.accounting.promptTokens).toBe(2500);
    expect(report.accounting.completionTokens).toBe(500);
    expect(report.accounting.totalTokens).toBe(3000);
    expect(report.accounting.costUsd).toBe('0.000500');
    expect(report.accounting.models).toEqual(['gpt-6-luna']);
  });

  it('carries the prompt version, mode, and scenario count into meta', () => {
    const report = buildReport(result(), META);
    expect(report.meta.promptVersion).toBe('diagnosis-v2');
    expect(report.meta.mode).toBe('real');
    expect(report.meta.scenarioCount).toBe(2);
    expect(report.meta.models).toEqual(['gpt-6-luna']);
  });

  it('falls back to the label when a run recorded no prompt version', () => {
    const runs: EvalRun[] = [run('seed_stripe_auth_401', AUTH, { promptVersion: null })];
    const scorecard = scoreScenarios([
      { scenario: scenario('seed_stripe_auth_401'), diagnosis: AUTH },
    ]);
    const report = buildReport({ runs, scorecard }, { ...META, label: 'fallback-label' });
    expect(report.meta.promptVersion).toBe('fallback-label');
  });
});

describe('reportFileStem', () => {
  it('builds a filesystem-safe <version>-<timestamp> stem', () => {
    const report = buildReport(result(), META);
    expect(reportFileStem(report)).toBe('diagnosis-v2-2026-11-15T10-30-00Z');
  });
});

describe('renderMarkdown', () => {
  it('renders accuracy, accounting, and a per-scenario row for a clean run', () => {
    const md = renderMarkdown(buildReport(result(), META));
    expect(md).toContain('# Eval Scorecard — diagnosis-v2');
    expect(md).toContain('**Accuracy: 100.0% (2/2)**');
    expect(md).toContain('**Cost (USD):** 0.000500');
    expect(md).toContain('`seed_stripe_auth_401`');
    // A clean run has no plumbing banner.
    expect(md).not.toContain('Plumbing run');
  });

  it('renders mean coverage as n/a when the run has only refusal scenarios', () => {
    const refusal: Diagnosis = {
      failureCategory: 'insufficient_evidence',
      rootCause: 'Too thin to classify.',
      confidence: 0.3,
      evidence: [],
      remediationSteps: ['Capture the response, then retry.'],
      reachabilityAssessment: 'unknown',
      isSpeculative: true,
    };
    const runs: EvalRun[] = [run('seed_stripe_insufficient_evidence', refusal)];
    const scorecard = scoreScenarios([
      { scenario: scenario('seed_stripe_insufficient_evidence'), diagnosis: refusal },
    ]);
    const md = renderMarkdown(buildReport({ runs, scorecard }, META));
    expect(md).toContain('**Mean coverage (field scenarios):** n/a (no field-citation scenarios)');
    expect(md).not.toContain('**Mean coverage (field scenarios):** 0.0%');
  });

  it('names a misclassification and marks the plumbing banner in fake mode', () => {
    const runs: EvalRun[] = [
      run('seed_stripe_auth_401', { ...AUTH, failureCategory: 'network_failure', evidence: [] }),
    ];
    const scorecard = scoreScenarios([
      { scenario: scenario('seed_stripe_auth_401'), diagnosis: runs[0].diagnosis },
    ]);
    const md = renderMarkdown(buildReport({ runs, scorecard }, { ...META, mode: 'fake' }));
    expect(md).toContain('Plumbing run');
    expect(md).toContain('expected `authentication`, predicted `network_failure`');
    expect(md).toContain('`seed_stripe_auth_401`');
  });
});
