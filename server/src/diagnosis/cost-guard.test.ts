import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the Prisma client so the daily-cap logic is tested deterministically, with no database. The
// two aggregate calls (Investigation + InvestigationMessage) are stubbed to return controlled sums.
const { investigationAggregate, messageAggregate } = vi.hoisted(() => ({
  investigationAggregate: vi.fn(),
  messageAggregate: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  prisma: {
    investigation: { aggregate: investigationAggregate },
    investigationMessage: { aggregate: messageAggregate },
  },
}));

const { assertDailyBudgetAvailable, DailyBudgetExceededError, sumTodaysSpendUsd } =
  await import('./cost-guard.js');

function sumResult(costUsd: string | null) {
  return { _sum: { costUsd: costUsd === null ? null : new Prisma.Decimal(costUsd) } };
}

afterEach(() => {
  delete process.env.OPENAI_DAILY_COST_CAP_USD;
  vi.clearAllMocks();
});

describe('sumTodaysSpendUsd', () => {
  it('sums investigation + message spend, treating a null _sum (no rows) as 0', async () => {
    investigationAggregate.mockResolvedValue(sumResult('1.250000'));
    messageAggregate.mockResolvedValue(sumResult(null));
    expect(await sumTodaysSpendUsd()).toBe(1.25);
  });
});

describe('assertDailyBudgetAvailable', () => {
  it('is a no-op (never queries) when no cap is configured', async () => {
    await expect(assertDailyBudgetAvailable()).resolves.toBeUndefined();
    expect(investigationAggregate).not.toHaveBeenCalled();
    expect(messageAggregate).not.toHaveBeenCalled();
  });

  it('resolves when today’s spend is under the cap', async () => {
    process.env.OPENAI_DAILY_COST_CAP_USD = '2.00';
    investigationAggregate.mockResolvedValue(sumResult('1.000000'));
    messageAggregate.mockResolvedValue(sumResult('0.500000'));
    await expect(assertDailyBudgetAvailable()).resolves.toBeUndefined();
  });

  it('throws DailyBudgetExceededError once spend reaches the cap', async () => {
    process.env.OPENAI_DAILY_COST_CAP_USD = '2.00';
    investigationAggregate.mockResolvedValue(sumResult('1.500000'));
    messageAggregate.mockResolvedValue(sumResult('0.750000'));
    await expect(assertDailyBudgetAvailable()).rejects.toBeInstanceOf(DailyBudgetExceededError);
  });
});
