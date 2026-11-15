import { describe, expect, it } from 'vitest';
import type { Diagnosis } from '../diagnosis/diagnosis.schema.js';
import { scenarios } from '../ingest/scenarios/index.js';
import type { Scenario } from '../ingest/scenarios/index.js';
import { scoreScenarios } from './scorers.js';
import type { ScoredInput } from './types.js';

// The harness "teeth" test, deterministic and DB-free: feed the scorers a set of hand-crafted correct
// diagnoses (everything green) and a regressed set (wrong category, missing/hallucinated evidence,
// overconfident refusal) and assert the scorecard actually catches the regressions. This is the
// guarantee that a degraded prompt won't slip past the eval — independent of any real model run.

function scenario(key: string): Scenario {
  const found = scenarios.find((s) => s.key === key);
  if (!found) throw new Error(`fixture scenario ${key} not found`);
  return found;
}

const correct: Record<string, Diagnosis> = {
  seed_stripe_auth_401: {
    failureCategory: 'authentication',
    rootCause: 'Rejected with 401 and an expired-key code.',
    confidence: 0.95,
    evidence: [
      { field: 'attempts[0].responseStatus', value: '401', note: 'Unauthorized.' },
      {
        field: 'attempts[0].responseHeaders["www-authenticate"]',
        value: 'Bearer realm="api"',
        note: 'Auth challenge.',
      },
      { field: 'attempts[0].responseBody.error.code', value: 'api_key_expired', note: 'Expired.' },
    ],
    remediationSteps: ['Rotate the key.'],
    reachabilityAssessment: 'reachable',
    isSpeculative: false,
  },
  seed_github_rate_limit_429: {
    failureCategory: 'rate_limit',
    rootCause: 'Throttled with 429 and a retry-after hint.',
    confidence: 0.9,
    evidence: [
      { field: 'attempts[0].responseStatus', value: '429', note: 'Too many requests.' },
      { field: 'attempts[0].responseHeaders["retry-after"]', value: '30', note: 'Backoff.' },
      {
        field: 'attempts[0].responseHeaders["x-ratelimit-remaining"]',
        value: '0',
        note: 'Exhausted.',
      },
    ],
    remediationSteps: ['Back off and retry.'],
    reachabilityAssessment: 'reachable',
    isSpeculative: false,
  },
  seed_slack_server_5xx: {
    failureCategory: 'server_error',
    rootCause: 'Receiver returned 503 Service Unavailable.',
    confidence: 0.85,
    evidence: [
      { field: 'attempts[0].responseStatus', value: '503', note: 'Service unavailable.' },
      { field: 'attempts[0].responseBody', value: 'Service Unavailable', note: 'Receiver down.' },
    ],
    remediationSteps: ['Retry later.'],
    reachabilityAssessment: 'reachable',
    isSpeculative: false,
  },
  seed_stripe_insufficient_evidence: {
    failureCategory: 'insufficient_evidence',
    rootCause: 'The logs are too thin to classify the cause.',
    confidence: 0.3,
    evidence: [],
    remediationSteps: ['Capture the response status and body, then retry.'],
    reachabilityAssessment: 'unknown',
    isSpeculative: true,
  },
};

function correctInputs(): ScoredInput[] {
  return Object.entries(correct).map(([key, diagnosis]) => ({
    scenario: scenario(key),
    diagnosis,
  }));
}

describe('scoreScenarios — a correct run is all green', () => {
  it('reports perfect accuracy, grounding, and calibration with no failures', () => {
    const card = scoreScenarios(correctInputs());

    expect(card.total).toBe(4);
    expect(card.classification.accuracy).toBe(1);
    expect(card.classification.misclassified).toEqual([]);
    expect(card.grounding.passRate).toBe(1);
    expect(card.grounding.failures).toEqual([]);
    // meanCoverage is over the 3 field scenarios; the refusal is tallied separately.
    expect(card.grounding.meanCoverage).toBe(1);
    expect(card.grounding.refusals).toEqual({ total: 1, correct: 1 });
    expect(card.calibration.okRate).toBe(1);
    expect(card.calibration.mismatches).toEqual([]);
  });

  it('produces a per-category breakdown covering each expected category once', () => {
    const card = scoreScenarios(correctInputs());
    expect(card.classification.perCategory).toEqual(
      expect.arrayContaining([
        { category: 'authentication', total: 1, correct: 1 },
        { category: 'rate_limit', total: 1, correct: 1 },
        { category: 'server_error', total: 1, correct: 1 },
        { category: 'insufficient_evidence', total: 1, correct: 1 },
      ]),
    );
  });
});

describe('scoreScenarios — a regressed run is caught (the harness has teeth)', () => {
  function regressedInputs(): ScoredInput[] {
    return [
      // Wrong category + no evidence: a classification miss and a grounding failure.
      {
        scenario: scenario('seed_stripe_auth_401'),
        diagnosis: {
          ...correct.seed_stripe_auth_401,
          failureCategory: 'network_failure',
          evidence: [],
        },
      },
      // Right category, but cites a fabricated field: a grounding failure only.
      {
        scenario: scenario('seed_github_rate_limit_429'),
        diagnosis: {
          ...correct.seed_github_rate_limit_429,
          evidence: [{ field: 'assumption', value: '429', note: 'Guessed.' }],
        },
      },
      // Still correct and grounded — proves the scorecard is mixed, not uniformly failing.
      {
        scenario: scenario('seed_slack_server_5xx'),
        diagnosis: correct.seed_slack_server_5xx,
      },
      // Guesses a confident concrete cause instead of refusing: grounding + calibration failure.
      {
        scenario: scenario('seed_stripe_insufficient_evidence'),
        diagnosis: {
          ...correct.seed_stripe_insufficient_evidence,
          confidence: 0.95,
          isSpeculative: false,
        },
      },
    ];
  }

  it('drops classification accuracy and names the misclassified scenario', () => {
    const card = scoreScenarios(regressedInputs());
    expect(card.classification.accuracy).toBeLessThan(1);
    expect(card.classification.misclassified).toContainEqual({
      key: 'seed_stripe_auth_401',
      expected: 'authentication',
      predicted: 'network_failure',
    });
  });

  it('drops the grounding pass rate and names every grounding failure', () => {
    const card = scoreScenarios(regressedInputs());
    expect(card.grounding.passRate).toBeLessThan(1);
    const failedKeys = card.grounding.failures.map((failure) => failure.key);
    expect(failedKeys).toEqual(
      expect.arrayContaining([
        'seed_stripe_auth_401',
        'seed_github_rate_limit_429',
        'seed_stripe_insufficient_evidence',
      ]),
    );
    expect(failedKeys).not.toContain('seed_slack_server_5xx');
  });

  it('flags the overconfident refusal as a calibration mismatch', () => {
    const card = scoreScenarios(regressedInputs());
    expect(card.calibration.mismatches).toContainEqual({
      key: 'seed_stripe_insufficient_evidence',
      note: 'overconfident on an ambiguous case',
    });
  });

  it('reports the botched refusal in the refusal tally, separate from field coverage', () => {
    const card = scoreScenarios(regressedInputs());
    // The refusal scenario guessed a confident concrete cause, so it is counted but not correct.
    expect(card.grounding.refusals).toEqual({ total: 1, correct: 0 });
    // meanCoverage reflects only the field scenarios (the refusal's 0/1 is excluded).
    expect(card.grounding.meanCoverage).toBeGreaterThan(0);
  });
});
