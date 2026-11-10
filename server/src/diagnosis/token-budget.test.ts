import { describe, expect, it } from 'vitest';
import {
  CHARS_PER_TOKEN,
  MAX_LOG_VALUE_CHARS,
  estimateTokens,
  truncateValue,
} from './token-budget.js';

describe('estimateTokens', () => {
  it('estimates ~1 token per CHARS_PER_TOKEN characters, rounding up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('a'.repeat(CHARS_PER_TOKEN))).toBe(1);
    expect(estimateTokens('a'.repeat(CHARS_PER_TOKEN + 1))).toBe(2);
  });
});

describe('truncateValue', () => {
  it('returns short values unchanged', () => {
    expect(truncateValue('short', 100)).toBe('short');
  });

  it('respects a value exactly at the cap', () => {
    const text = 'x'.repeat(50);
    expect(truncateValue(text, 50)).toBe(text);
  });

  it('truncates to the cap and appends a pointer naming the original length', () => {
    const text = 'x'.repeat(5000);
    const result = truncateValue(text, 2000);

    // The shown prefix is exactly the cap; the pointer footer follows.
    expect(result.startsWith('x'.repeat(2000))).toBe(true);
    expect(result).toContain('[truncated — showing first 2000 of 5000 chars');
    expect(result).toContain('full body in the delivery record');
    // The pointer makes the result longer than the cap, but the *shown data* is capped.
    expect(result.length).toBeGreaterThan(2000);
  });

  it('defaults to MAX_LOG_VALUE_CHARS', () => {
    const text = 'y'.repeat(MAX_LOG_VALUE_CHARS + 10);
    const result = truncateValue(text);
    expect(result).toContain(`showing first ${MAX_LOG_VALUE_CHARS} of ${text.length} chars`);
  });
});
