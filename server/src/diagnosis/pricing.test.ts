import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeCostUsd } from './pricing.js';

describe('computeCostUsd', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prices a known model from input + output tokens', () => {
    // gpt-4o-2024-08-06: $2.50 / 1M input, $10.00 / 1M output.
    // 1000 * 2.5/1e6 = 0.0025; 500 * 10/1e6 = 0.005; total = 0.0075.
    const cost = computeCostUsd('gpt-4o-2024-08-06', 1000, 500);
    expect(cost.equals(new Prisma.Decimal('0.0075'))).toBe(true);
  });

  it('computes exact decimal cost (no binary-float drift)', () => {
    // 333 * 2.5/1e6 + 777 * 10/1e6 = 0.0008325 + 0.0077700 = 0.0086025, exact under decimal math.
    const cost = computeCostUsd('gpt-4o-2024-08-06', 333, 777);
    expect(cost.equals(new Prisma.Decimal('0.0086025'))).toBe(true);
  });

  it('prices the gpt-4o-mini tier from its own rates', () => {
    // Verifies the second table entry (the Phase 6 cheaper tier) isn't a stale/typo'd rate:
    // 1M input @ $0.15 + 1M output @ $0.60 = $0.75 exactly.
    const cost = computeCostUsd('gpt-4o-mini-2024-07-18', 1_000_000, 1_000_000);
    expect(cost.equals(new Prisma.Decimal('0.75'))).toBe(true);
  });

  it('is zero when both token counts are zero', () => {
    expect(computeCostUsd('gpt-4o-2024-08-06', 0, 0).equals(new Prisma.Decimal(0))).toBe(true);
  });

  it('falls back to zero cost and warns for an unknown model (never throws)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cost = computeCostUsd('some-unlisted-model', 1000, 1000);
    expect(cost.equals(new Prisma.Decimal(0))).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('some-unlisted-model');
  });
});
