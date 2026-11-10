// Lightweight context-budgeting primitives for Phase-6 chat. Deliberately dependency-free: a
// char-based token estimate (~4 chars/token) is accurate enough to decide "does this block fit the
// budget / which long body do we truncate" without pulling in a BPE tokenizer. The real token count
// still comes from OpenAI's usage on every call (that's what we bill against); these estimates only
// drive the truncation/eviction decisions made before the call.

/** Average characters per token for English + JSON log text. A coarse, intentionally conservative estimate. */
export const CHARS_PER_TOKEN = 4;

/**
 * The token ceiling for everything we send in one chat request (system prompt + diagnosis snapshot +
 * logs + replayed history + the new question). Sized well under the model's context window so the
 * completion always has room; the point is bounded, predictable requests, not maximal context.
 */
export const CHAT_CONTEXT_TOKEN_BUDGET = 6000;

/**
 * Max characters any single serialized request/response body may occupy before it's truncated with a
 * pointer. The upper bound on the budget-derived per-body cap: keeps one pathological 50KB body from
 * crowding out the rest of the context while still showing enough of it to cite.
 */
export const MAX_LOG_VALUE_CHARS = 2000;

/**
 * Lower bound on the budget-derived per-body cap. Even when many attempts share a tight logs budget,
 * each body keeps at least this many characters so its head stays citable rather than collapsing to
 * just the truncation pointer.
 */
export const MIN_BODY_CHARS = 200;

/**
 * Floor on the tokens reserved for the delivery-logs block. The logs are the evidence a grounded
 * answer cites, so even when the snapshot/question are large the logs are never starved below this —
 * history is evicted instead. Sits under CHAT_CONTEXT_TOKEN_BUDGET so the two leave room for each other.
 */
export const LOGS_MIN_TOKENS = 1500;

/** Estimate the token count of a text blob. `ceil(len / CHARS_PER_TOKEN)`; empty string → 0. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncate an over-long serialized value, appending a pointer back to the full data so the model
 * knows the body continues and where to find it (the "pointers back to full data" requirement). A
 * value already within `maxChars` is returned unchanged. The pointer names the original length so a
 * reader can tell how much was elided.
 */
export function truncateValue(text: string, maxChars: number = MAX_LOG_VALUE_CHARS): string {
  if (text.length <= maxChars) {
    return text;
  }
  const shown = text.slice(0, maxChars);
  return `${shown}… [truncated — showing first ${maxChars} of ${text.length} chars; full body in the delivery record]`;
}
