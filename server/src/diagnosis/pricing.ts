import { Prisma } from '@prisma/client';

// Per-model token pricing, so every Investigation carries an honest `costUsd`. Prices are USD per
// 1M tokens (OpenAI's published list-price unit) and are deliberately data, not logic — update the
// table when OpenAI changes prices or we add a model tier. Cost is computed with Prisma.Decimal
// (decimal.js) rather than JS floats so the value matches the `Decimal(10,6)` column exactly and
// does not accumulate binary-float error over many investigations.

interface ModelPrice {
  /** USD per 1M prompt (input) tokens. */
  inputPerMillion: number;
  /** USD per 1M completion (output) tokens. */
  outputPerMillion: number;
}

const TOKENS_PER_MILLION = 1_000_000;

/** Known model list prices. Unknown models fall back to 0 (see computeCostUsd). */
const MODEL_PRICING: Record<string, ModelPrice> = {
  'gpt-4o-2024-08-06': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini-2024-07-18': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

/**
 * Compute the USD cost of one diagnosis call. An unknown model records `0` and warns rather than
 * throwing — a missing price-table entry must never fail an otherwise-successful investigation; it
 * degrades the accounting, not the diagnosis. Keep this the only place token→cost math lives.
 */
export function computeCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): Prisma.Decimal {
  const price = MODEL_PRICING[model];
  if (price === undefined) {
    console.warn(`pricing: no price table entry for model "${model}"; recording costUsd=0`);
    return new Prisma.Decimal(0);
  }

  const inputCost = new Prisma.Decimal(promptTokens)
    .times(price.inputPerMillion)
    .dividedBy(TOKENS_PER_MILLION);
  const outputCost = new Prisma.Decimal(completionTokens)
    .times(price.outputPerMillion)
    .dividedBy(TOKENS_PER_MILLION);

  return inputCost.plus(outputCost);
}
