import { afterEach, describe, expect, it } from 'vitest';
import { env } from './env.js';

// Unit tests for the eval threshold env getters. These validate the WFI_EVAL_MIN_* overrides that
// `pnpm eval --check` reads (the parsing that used to live in eval/thresholds.ts's resolveThresholds).
// The getters read process.env lazily at access time, so each case sets the var, reads env, and
// restores — no spawning, no DB. The stricter contract: unset → undefined (caller uses the default);
// set-but-invalid (blank / non-numeric / out of [0,1]) → throw, so a typo fails loudly.

const KEYS = [
  'WFI_EVAL_MIN_ACCURACY',
  'WFI_EVAL_MIN_GROUNDING',
  'OPENAI_REASONING_EFFORT',
] as const;

afterEach(() => {
  for (const key of KEYS) {
    delete process.env[key];
  }
});

describe('env.EVAL_MIN_ACCURACY / EVAL_MIN_GROUNDING', () => {
  it('is undefined when the override is unset (caller applies the default)', () => {
    expect(env.EVAL_MIN_ACCURACY).toBeUndefined();
    expect(env.EVAL_MIN_GROUNDING).toBeUndefined();
  });

  it('parses a valid in-range override', () => {
    process.env.WFI_EVAL_MIN_ACCURACY = '0.95';
    process.env.WFI_EVAL_MIN_GROUNDING = '0';
    expect(env.EVAL_MIN_ACCURACY).toBe(0.95);
    expect(env.EVAL_MIN_GROUNDING).toBe(0);
  });

  it('throws on a non-numeric value', () => {
    process.env.WFI_EVAL_MIN_ACCURACY = 'high';
    expect(() => env.EVAL_MIN_ACCURACY).toThrow(/\[0,1\]/);
  });

  it('throws on an out-of-range value', () => {
    process.env.WFI_EVAL_MIN_GROUNDING = '1.5';
    expect(() => env.EVAL_MIN_GROUNDING).toThrow(/\[0,1\]/);
  });

  it('throws on a blank value rather than silently resolving to 0 (Number("") === 0)', () => {
    process.env.WFI_EVAL_MIN_ACCURACY = '';
    process.env.WFI_EVAL_MIN_GROUNDING = '   ';
    expect(() => env.EVAL_MIN_ACCURACY).toThrow(/\[0,1\]/);
    expect(() => env.EVAL_MIN_GROUNDING).toThrow(/\[0,1\]/);
  });
});

describe('env.OPENAI_REASONING_EFFORT', () => {
  it('defaults to medium when unset or blank (no override supplied)', () => {
    expect(env.OPENAI_REASONING_EFFORT).toBe('medium');
    process.env.OPENAI_REASONING_EFFORT = '';
    expect(env.OPENAI_REASONING_EFFORT).toBe('medium');
  });

  it('passes through a known effort level', () => {
    process.env.OPENAI_REASONING_EFFORT = 'high';
    expect(env.OPENAI_REASONING_EFFORT).toBe('high');
    process.env.OPENAI_REASONING_EFFORT = 'none';
    expect(env.OPENAI_REASONING_EFFORT).toBe('none');
  });

  it('throws on an unknown level rather than reaching the API with a bad argument', () => {
    process.env.OPENAI_REASONING_EFFORT = 'ultra';
    expect(() => env.OPENAI_REASONING_EFFORT).toThrow(/OPENAI_REASONING_EFFORT/);
  });
});
