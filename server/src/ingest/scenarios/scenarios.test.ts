import { describe, expect, it } from 'vitest';
import { FAILURE_CATEGORIES } from '../../domain/failure-category.js';
import { redactHeaders } from '../redact.js';
import { ManualSubmissionSchema } from '../schemas.js';
import { SEED_ID_PREFIX } from '../seed.js';
import { scenarios } from './index.js';

// DB-free checks on the scenario library itself: every fixture is a valid, well-labeled submission,
// and (belt-and-suspenders beside the shell secret-redaction-guard) no header value in the fixtures
// is an unredacted secret. The persistence/redaction-on-load behavior is covered by seed.int.test.ts.

describe('scenario library', () => {
  it('has unique, seed-prefixed keys', () => {
    const keys = scenarios.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key.startsWith(SEED_ID_PREFIX)).toBe(true);
  });

  it('holds 8–12 scenarios covering every failure category', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(8);
    expect(scenarios.length).toBeLessThanOrEqual(12);
    const covered = new Set(scenarios.map((s) => s.expected.category));
    for (const category of FAILURE_CATEGORIES) expect(covered).toContain(category);
  });

  it.each(scenarios.map((s) => [s.key, s] as const))(
    '%s is a valid, well-labeled submission',
    (_key, scenario) => {
      expect(ManualSubmissionSchema.safeParse(scenario.submission).success).toBe(true);
      expect(FAILURE_CATEGORIES).toContain(scenario.expected.category);
      expect(scenario.expected.evidence.length).toBeGreaterThan(0);
    },
  );

  it.each(scenarios.map((s) => [s.key, s] as const))(
    '%s has no unredacted secret headers',
    (_key, scenario) => {
      // redactHeaders is idempotent, so pre-redacted fixtures are a no-op: equality proves every
      // secret-named header already carries [REDACTED] rather than a raw value.
      expect(redactHeaders(scenario.submission.headers)).toEqual(scenario.submission.headers);
      for (const attempt of scenario.submission.attempts) {
        expect(redactHeaders(attempt.requestHeaders)).toEqual(attempt.requestHeaders);
      }
    },
  );
});
