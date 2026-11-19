import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../db/client.js';

// Global daily OpenAI cost cap (Phase 10, B7) — the "open demo + caps" model's primary spend control.
// Before any paid call, the two paid services sum today's spend (UTC) across every Investigation and
// InvestigationMessage `costUsd` and refuse once it reaches the cap, so a public demo can't run up an
// unbounded OpenAI bill. This reuses the existing per-record cost accounting (pricing.ts writes those
// columns) rather than standing up new infrastructure, and because it reads from the DB the budget
// survives restarts/redeploys (unlike an in-memory counter). A provider-side monthly budget in the
// OpenAI dashboard is the un-bypassable backstop if app logic ever fails.

/**
 * Thrown by the paid services when today's spend has reached the configured daily cap. The services
 * throw this BEFORE spending (and, for chat, before the SSE stream opens), so error-handler.ts maps
 * it to a friendly 429 in the standard envelope and nothing is billed.
 */
export class DailyBudgetExceededError extends Error {
  /** Today's summed spend (USD) at the time of refusal. */
  readonly spentUsd: number;
  /** The configured daily cap (USD). */
  readonly capUsd: number;

  constructor(spentUsd: number, capUsd: number) {
    super('The daily demo budget has been reached — please try again tomorrow.');
    this.name = 'DailyBudgetExceededError';
    this.spentUsd = spentUsd;
    this.capUsd = capUsd;
  }
}

/** Midnight today in UTC — the lower bound for "today's" spend (matches the cap's documented window). */
function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Sum today's OpenAI spend (UTC) across both paid record types. Uses Prisma's DB-side `_sum` so the
 * total is computed in Postgres (no row-loading) and stays exact as a Decimal before converting to a
 * number for the comparison.
 */
export async function sumTodaysSpendUsd(): Promise<number> {
  const since = startOfUtcDay();
  const [investigations, messages] = await Promise.all([
    prisma.investigation.aggregate({
      _sum: { costUsd: true },
      where: { createdAt: { gte: since } },
    }),
    prisma.investigationMessage.aggregate({
      _sum: { costUsd: true },
      where: { createdAt: { gte: since } },
    }),
  ]);
  const investigationSum = investigations._sum.costUsd ?? new Prisma.Decimal(0);
  const messageSum = messages._sum.costUsd ?? new Prisma.Decimal(0);
  return investigationSum.plus(messageSum).toNumber();
}

/**
 * Refuse a paid call if today's spend has reached the daily cap. No cap configured
 * (`OPENAI_DAILY_COST_CAP_USD` unset) → always allowed (the provider-side monthly budget is then the
 * only ceiling). Called at the top of the diagnosis and chat services, before any OpenAI call.
 */
export async function assertDailyBudgetAvailable(): Promise<void> {
  const cap = env.OPENAI_DAILY_COST_CAP_USD;
  if (cap === undefined) {
    return;
  }
  const spent = await sumTodaysSpendUsd();
  if (spent >= cap) {
    throw new DailyBudgetExceededError(spent, cap);
  }
}
