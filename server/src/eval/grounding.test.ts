import { describe, expect, it } from 'vitest';
import type { Diagnosis } from '../diagnosis/diagnosis.schema.js';
import { scenarios } from '../ingest/scenarios/index.js';
import type { Scenario } from '../ingest/scenarios/index.js';
import { normalizePath, pathsMatch, scoreGrounding } from './grounding.js';

// Deterministic unit tests for the grounding scorer against the *real* expected.evidence strings in
// the seed library — the prose/absence formats are exactly what the scorer has to tolerate. No DB, no
// model: just crafted diagnoses fed through scoreGrounding.

function scenario(key: string): Scenario {
  const found = scenarios.find((s) => s.key === key);
  if (!found) throw new Error(`fixture scenario ${key} not found`);
  return found;
}

function diagnosis(overrides: Partial<Diagnosis>): Diagnosis {
  return {
    failureCategory: 'authentication',
    rootCause: 'test',
    confidence: 0.9,
    evidence: [],
    remediationSteps: ['fix it'],
    reachabilityAssessment: 'reachable',
    isSpeculative: false,
    ...overrides,
  };
}

describe('normalizePath', () => {
  it('flattens array indices and bracketed, quoted keys to lowercase segments', () => {
    expect(normalizePath('attempts[0].responseStatus')).toEqual([
      'attempts',
      '0',
      'responsestatus',
    ]);
    expect(normalizePath('attempts[0].responseHeaders["www-authenticate"]')).toEqual([
      'attempts',
      '0',
      'responseheaders',
      'www-authenticate',
    ]);
    expect(normalizePath('responseHeaders["retry-after"]')).toEqual([
      'responseheaders',
      'retry-after',
    ]);
  });
});

describe('pathsMatch', () => {
  it('matches equal paths and either-direction containment', () => {
    const full = normalizePath('attempts[0].responseBody.error.code');
    expect(pathsMatch(full, full)).toBe(true);
    // Citing the parent region counts for a more specific label.
    expect(pathsMatch(normalizePath('attempts[0].responseBody'), full)).toBe(true);
    // A bare-leaf label matches a fully-qualified citation (contiguous suffix).
    expect(
      pathsMatch(normalizePath('responseStatus'), normalizePath('attempts[0].responseStatus')),
    ).toBe(true);
  });

  it('does not match unrelated paths', () => {
    expect(
      pathsMatch(
        normalizePath('attempts[0].responseStatus'),
        normalizePath('attempts[0].latencyMs'),
      ),
    ).toBe(false);
  });
});

describe('scoreGrounding — grounded diagnoses', () => {
  it('passes when a diagnosis cites the expected fields and values (auth 401)', () => {
    const result = scoreGrounding(
      scenario('seed_stripe_auth_401'),
      diagnosis({
        failureCategory: 'authentication',
        evidence: [
          { field: 'attempts[0].responseStatus', value: '401', note: 'Unauthorized.' },
          {
            field: 'attempts[0].responseHeaders["www-authenticate"]',
            value: 'Bearer realm="api"',
            note: 'Challenge present.',
          },
          {
            field: 'attempts[0].responseBody.error.code',
            value: 'api_key_expired',
            note: 'Expired key.',
          },
        ],
      }),
    );
    expect(result.grounded).toBe(true);
    expect(result.coverage).toBe(1);
    expect(result.hallucinatedFields).toEqual([]);
  });

  it('counts a parent-region citation for a more specific labeled field', () => {
    const result = scoreGrounding(
      scenario('seed_stripe_auth_401'),
      diagnosis({
        evidence: [
          { field: 'attempts[0].responseStatus', value: '401', note: 'Unauthorized.' },
          {
            field: 'attempts[0].responseBody',
            value: '{"error":{"code":"api_key_expired"}}',
            note: 'Body carries the expired-key code.',
          },
        ],
      }),
    );
    // responseStatus==401 and responseBody.error.code=="api_key_expired" are both covered.
    expect(result.coveredItems).toBeGreaterThanOrEqual(2);
    expect(result.grounded).toBe(true);
  });

  it('matches a two-field-in-one-string label (429 + retry-after)', () => {
    const result = scoreGrounding(
      scenario('seed_github_retry_429_then_200'),
      diagnosis({
        failureCategory: 'rate_limit',
        evidence: [
          { field: 'attempts[0].responseStatus', value: '429', note: 'Rate limited.' },
          {
            field: 'attempts[0].responseHeaders["retry-after"]',
            value: '2',
            note: 'Backoff hint.',
          },
          { field: 'attempts[1].responseStatus', value: '200', note: 'Succeeded after backoff.' },
        ],
      }),
    );
    expect(result.grounded).toBe(true);
    expect(result.coverage).toBe(1);
  });
});

describe('scoreGrounding — failures', () => {
  it('fails on an empty evidence array', () => {
    const result = scoreGrounding(scenario('seed_stripe_auth_401'), diagnosis({ evidence: [] }));
    expect(result.grounded).toBe(false);
    expect(result.reason).toBe('cites no evidence');
  });

  it('fails when the cited value does not match the expected value', () => {
    const result = scoreGrounding(
      scenario('seed_stripe_auth_401'),
      diagnosis({
        evidence: [{ field: 'attempts[0].responseStatus', value: '500', note: 'Wrong value.' }],
      }),
    );
    expect(result.grounded).toBe(false);
  });

  it('flags a citation that resolves to no real log field as hallucinated', () => {
    const result = scoreGrounding(
      scenario('seed_github_rate_limit_429'),
      diagnosis({
        failureCategory: 'rate_limit',
        evidence: [{ field: 'assumption', value: '429', note: 'Guessed.' }],
      }),
    );
    expect(result.grounded).toBe(false);
    expect(result.hallucinatedFields).toEqual(['assumption']);
    expect(result.reason).toContain('non-log fields');
  });

  it('does not credit the right field with the wrong value, even when an unrelated entry carries the value', () => {
    // The 401 appears on an unrelated field (latencyMs); the field it belongs to (responseStatus) is
    // cited with the wrong value. Path and value must land on the SAME citation, so this is not covered.
    const result = scoreGrounding(
      scenario('seed_stripe_auth_401'),
      diagnosis({
        evidence: [
          {
            field: 'attempts[0].responseStatus',
            value: '500',
            note: 'Wrong value on the right field.',
          },
          { field: 'attempts[0].latencyMs', value: '401', note: 'Right value on the wrong field.' },
        ],
      }),
    );
    expect(result.grounded).toBe(false);
  });

  it('does not credit the right field with a wrong value that merely shares a digit', () => {
    // Expected values for this scenario include '2' (retry-after). A diagnosis citing responseStatus
    // as '200' (the real status was 429) must NOT be credited by substring — '200'.includes('2').
    const result = scoreGrounding(
      scenario('seed_github_retry_429_then_200'),
      diagnosis({
        failureCategory: 'rate_limit',
        evidence: [{ field: 'attempts[0].responseStatus', value: '200', note: 'Wrong status.' }],
      }),
    );
    expect(result.grounded).toBe(false);
  });

  it('fails closed on a scenario whose only expected label names no field (prose-only)', () => {
    // A token-less label can't be grounded by a citation, so it is not scorable and the diagnosis
    // fails grounding even though it cites a real field — surfacing the label bug rather than hiding it.
    const base = scenario('seed_slack_server_5xx');
    const proseOnly: Scenario = {
      ...base,
      expected: { category: 'server_error', evidence: ['the body indicates a server problem'] },
    };
    const result = scoreGrounding(
      proseOnly,
      diagnosis({
        failureCategory: 'server_error',
        evidence: [{ field: 'attempts[0].responseStatus', value: '503', note: 'Unavailable.' }],
      }),
    );
    expect(result.grounded).toBe(false);
    expect(result.totalItems).toBe(0);
  });

  it('flags a concrete value invented for a genuinely-absent field as hallucinated', () => {
    // The timeout scenario never received a response, so responseStatus serializes as `(absent)`.
    // Citing a concrete status code for it is a fabrication, not grounding.
    const result = scoreGrounding(
      scenario('seed_github_timeout'),
      diagnosis({
        failureCategory: 'timeout',
        evidence: [{ field: 'attempts[0].responseStatus', value: '500', note: 'Invented.' }],
      }),
    );
    expect(result.grounded).toBe(false);
    expect(result.hallucinatedFields).toContain('attempts[0].responseStatus');
  });

  it('credits a correct grounding of the timeout scenario (errorText + latency)', () => {
    const result = scoreGrounding(
      scenario('seed_github_timeout'),
      diagnosis({
        failureCategory: 'timeout',
        evidence: [
          { field: 'attempts[0].errorText', value: 'ETIMEDOUT: timed out', note: 'Timed out.' },
          { field: 'attempts[0].latencyMs', value: '10000', note: 'Hit the limit.' },
        ],
      }),
    );
    expect(result.grounded).toBe(true);
    expect(result.hallucinatedFields).toEqual([]);
  });
});

describe('scoreGrounding — insufficient_evidence refusal', () => {
  const insufficient = scenario('seed_stripe_insufficient_evidence');

  it('passes when the diagnosis refuses (insufficient_evidence + speculative), even with no citations', () => {
    const result = scoreGrounding(
      insufficient,
      diagnosis({ failureCategory: 'insufficient_evidence', confidence: 0.3, isSpeculative: true }),
    );
    expect(result.grounded).toBe(true);
  });

  it('fails when the model guesses a concrete cause instead of refusing', () => {
    const result = scoreGrounding(
      insufficient,
      diagnosis({ failureCategory: 'timeout', confidence: 0.8, isSpeculative: false }),
    );
    expect(result.grounded).toBe(false);
    expect(result.reason).toContain('insufficient_evidence');
  });

  it('fails when classified insufficient_evidence but not flagged speculative', () => {
    const result = scoreGrounding(
      insufficient,
      diagnosis({ failureCategory: 'insufficient_evidence', isSpeculative: false }),
    );
    expect(result.grounded).toBe(false);
  });
});
