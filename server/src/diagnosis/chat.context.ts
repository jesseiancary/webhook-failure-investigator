import type { Diagnosis } from './diagnosis.schema.js';
import type { ChatMessage } from './prompt.js';
import {
  formatDeliveryHistoryBlock,
  formatEventPayloadBlock,
  formatValue,
  type SerializableAttempt,
  type SerializableEnvelope,
  type SerializableEvent,
} from './serialize.js';
import {
  CHARS_PER_TOKEN,
  CHAT_CONTEXT_TOKEN_BUDGET,
  LOGS_MIN_TOKENS,
  MAX_LOG_VALUE_CHARS,
  MIN_BODY_CHARS,
  estimateTokens,
  truncateValue,
} from './token-budget.js';

// Phase-6 chat context assembly. A follow-up question is answered from the SAME logs the diagnosis
// was grounded in, re-serialized into the prompt each turn (the logs-in-context design) rather than
// re-fetched via tools. This module builds that context deterministically: the prior diagnosis as an
// anchor, the delivery logs (long bodies truncated to a budget), the replayed chat history, and the
// new question. Pure functions over loose structural inputs, so it unit-tests without a DB or network.

/** Stamped alongside chat turns so an answer is traceable to the prompt that produced it. */
export const CHAT_PROMPT_VERSION = 'chat-v1';

export const CHAT_SYSTEM_PROMPT = `You are the Webhook Failure Investigator, now answering follow-up
questions about a single webhook delivery you have already diagnosed.

The next message gives you the prior diagnosis and the delivery logs it was grounded in (the event
payload and every delivery attempt, with citable field paths). Answer ONLY from that material.

GROUNDING RULE (never break it):
- Ground every claim in a field from the provided logs, cited by its field path (e.g.
  attempts[0].responseStatus, attempts[0].responseBody.error.code). Never invent a status code,
  header, or body value that the logs do not show.
- A long body may be truncated with a "[truncated …]" marker; do not assume anything about the
  elided part — say the detail isn't available if the question turns on it.
- If the logs don't contain enough grounded signal to answer, say so plainly rather than guessing.
  "The logs don't show that" is a correct answer.
- The prior diagnosis is context, not evidence: you may refer to it, but support your answer with the
  underlying log fields — and feel free to disagree with it if the logs warrant.

Answer concisely in plain language (short paragraphs or bullets). Secrets are already redacted to
"[REDACTED]"; treat a redacted value as present-but-hidden, never as the failure cause.`;

/**
 * A persisted message row as chat replay needs to read it — the structural subset of
 * `InvestigationMessage` (role, content, the `toolCalls` discriminator, and the `seq` ordinal).
 * Typed loosely so a Prisma row satisfies it without ceremony and tests can hand-author fixtures.
 */
export interface ChatHistoryRow {
  role: string;
  content: string;
  /** Present (an array) on Phase-5 diagnosis-trace assistant rows; null/absent on chat answer rows. */
  toolCalls?: unknown;
  /** Monotonic ordinal used to replay in insertion order. */
  seq: number;
}

/** The inputs `assembleChatMessages` composes into one turn's request. */
export interface ChatContextInput {
  /** The prior diagnosis (already parsed from the stored Json via DiagnosisSchema). */
  diagnosis: Diagnosis;
  /** The event + its attempts the diagnosis covered; re-serialized (and truncated) into context. */
  event: SerializableEvent;
  /** The full persisted message thread for the investigation (chat + diagnosis trace, unfiltered). */
  history: ChatHistoryRow[];
  /** The new follow-up question. */
  userMessage: string;
  /** Token ceiling for the assembled request (defaults to CHAT_CONTEXT_TOKEN_BUDGET). */
  budget?: number;
}

/** Render a compact, cite-able summary of the prior diagnosis to anchor the follow-up (context, not evidence). */
export function buildDiagnosisSnapshot(diagnosis: Diagnosis): string {
  return [
    'PRIOR DIAGNOSIS (context only — ground your answer in the DELIVERY LOGS below, not this summary):',
    `failureCategory: ${diagnosis.failureCategory}`,
    `confidence: ${diagnosis.confidence}`,
    `reachabilityAssessment: ${diagnosis.reachabilityAssessment}`,
    `isSpeculative: ${diagnosis.isSpeculative}`,
    `rootCause: ${diagnosis.rootCause}`,
    'evidence:',
    ...diagnosis.evidence.map((e) => `- ${e.field} = ${e.value} — ${e.note}`),
    'remediationSteps:',
    ...diagnosis.remediationSteps.map((step) => `- ${step}`),
  ].join('\n');
}

/**
 * Replace an over-long serialized value with its truncated form (a string the serializer renders
 * verbatim); leave a value within budget untouched so it renders as normal JSON. `null`/absent pass
 * through so their `(absent)` rendering — itself diagnostic — is preserved.
 */
function maybeTruncate(value: unknown, maxChars: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  const serialized = formatValue(value);
  return serialized.length > maxChars ? truncateValue(serialized, maxChars) : value;
}

/**
 * Serialize the event payload + full delivery history into the citable text block the chat answer
 * grounds against, using the SAME serializer the diagnosis tools use (so field paths match). Only the
 * request/response **bodies** (and the event payload) are truncated to `maxBodyChars` — the big,
 * variable values; headers, status, latency, and error text are left intact so citations like
 * `responseHeaders["www-authenticate"]` always resolve. Every attempt is always rendered, so
 * `attempts[i]` indices stay stable (dropping attempts would shift indices and break grounding).
 */
export function buildLogContext(
  event: SerializableEvent,
  maxBodyChars: number = MAX_LOG_VALUE_CHARS,
): string {
  const envelope: SerializableEnvelope = {
    source: event.source,
    eventType: event.eventType,
    payload: maybeTruncate(event.payload, maxBodyChars),
    headers: event.headers,
  };
  const attempts: SerializableAttempt[] = event.attempts.map((attempt) => ({
    ...attempt,
    requestBody: maybeTruncate(attempt.requestBody, maxBodyChars),
    responseBody: maybeTruncate(attempt.responseBody, maxBodyChars),
  }));
  return `${formatEventPayloadBlock(envelope)}\n\n${formatDeliveryHistoryBlock(attempts)}`;
}

/** Clamp `value` into the inclusive `[min, max]` range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The truncatable bodies present in the logs (event payload + each attempt's request/response body). */
function truncatableBodies(event: SerializableEvent): unknown[] {
  return [event.payload, ...event.attempts.flatMap((a) => [a.requestBody, a.responseBody])].filter(
    (v) => v !== null && v !== undefined,
  );
}

/** The event with every truncatable body removed, for measuring the fixed (non-body) log overhead. */
function stripBodies(event: SerializableEvent): SerializableEvent {
  return {
    ...event,
    payload: null,
    attempts: event.attempts.map((a) => ({ ...a, requestBody: null, responseBody: null })),
  };
}

/**
 * Derive the per-body character cap so the whole delivery-logs block fits its token budget while
 * keeping every attempt present. The non-body overhead (labels, headers, statuses) is measured, then
 * the remaining budget is split evenly across the bodies and clamped to `[MIN_BODY_CHARS,
 * MAX_LOG_VALUE_CHARS]`. Bodies therefore shrink as attempts multiply instead of the request growing
 * unbounded — the tradeoff that honors "enforce a token budget per request" without dropping attempts.
 */
function deriveBodyCap(event: SerializableEvent, budget: number, nonLogBaseTokens: number): number {
  const logsTokenBudget = Math.max(budget - nonLogBaseTokens, LOGS_MIN_TOKENS);
  const bodies = truncatableBodies(event);
  if (bodies.length === 0) {
    return MAX_LOG_VALUE_CHARS;
  }
  const overheadTokens = estimateTokens(buildLogContext(stripBodies(event), MAX_LOG_VALUE_CHARS));
  const minBodyTokens = bodies.length * Math.ceil(MIN_BODY_CHARS / CHARS_PER_TOKEN);
  const bodyTokenBudget = Math.max(logsTokenBudget - overheadTokens, minBodyTokens);
  return clamp(
    Math.floor((bodyTokenBudget * CHARS_PER_TOKEN) / bodies.length),
    MIN_BODY_CHARS,
    MAX_LOG_VALUE_CHARS,
  );
}

/**
 * Select the chat conversation out of the persisted thread, oldest-first. Chat turns are exactly the
 * `user` rows and the plain `assistant` answer rows (no `toolCalls`); this excludes the Phase-5
 * diagnosis retrieval trace (its assistant rows carry `toolCalls`, its results are `role:'tool'`),
 * which is redundant here (logs are re-provided fresh each turn) and malformed to replay standalone.
 * Invariant: a chat assistant row never carries `toolCalls` — chat advertises no tools.
 */
export function loadChatHistory(messages: ChatHistoryRow[]): ChatMessage[] {
  return [...messages]
    .sort((a, b) => a.seq - b.seq)
    .filter(
      (m) =>
        m.role === 'user' ||
        (m.role === 'assistant' && (m.toolCalls === null || m.toolCalls === undefined)),
    )
    .map((m): ChatMessage =>
      m.role === 'user'
        ? { role: 'user', content: m.content }
        : { role: 'assistant', content: m.content },
    );
}

/** Estimated token cost of replaying a set of history messages. */
function historyTokens(history: ChatMessage[]): number {
  return history.reduce((sum, m) => sum + estimateTokens(m.content ?? ''), 0);
}

/**
 * Drop the oldest chat turns (a user question + its assistant answer, two rows) until the whole
 * request fits the budget. The system prompt, diagnosis snapshot, logs, and the new question are
 * fixed costs we always keep; only replayed history is evictable — so a long thread stays within the
 * context window without erroring (it loses the earliest turns, newest-first being most relevant).
 *
 * `slice(2)` drops a whole turn at a time, which relies on history being strict user→assistant pairs.
 * `loadChatHistory` guarantees that ordering (chat persists a user row then its assistant answer), so
 * the two rows removed are always a question and its reply, never a question and someone else's reply.
 */
function fitHistoryToBudget(
  baseTokens: number,
  history: ChatMessage[],
  budget: number,
): ChatMessage[] {
  let trimmed = history;
  while (trimmed.length > 0 && baseTokens + historyTokens(trimmed) > budget) {
    trimmed = trimmed.slice(2);
  }
  return trimmed;
}

/**
 * Assemble one chat turn's request: `[system] + [diagnosis snapshot + logs] + [replayed history] +
 * [new question]`, trimmed to the token budget. This is the single entry point the chat service calls
 * per turn.
 */
export function assembleChatMessages(input: ChatContextInput): ChatMessage[] {
  const budget = input.budget ?? CHAT_CONTEXT_TOKEN_BUDGET;
  const snapshot = buildDiagnosisSnapshot(input.diagnosis);

  // Size the logs to the budget left after the fixed non-log costs, so the whole request is bounded
  // (not just the evictable history) while every attempt stays present. Then build the real logs with
  // that per-body cap and evict history against whatever budget remains.
  const nonLogBaseTokens =
    estimateTokens(CHAT_SYSTEM_PROMPT) +
    estimateTokens(snapshot) +
    estimateTokens(input.userMessage);
  const bodyCap = deriveBodyCap(input.event, budget, nonLogBaseTokens);
  const contextBlock = `${snapshot}\n\n${buildLogContext(input.event, bodyCap)}`;
  const history = loadChatHistory(input.history);

  const baseTokens =
    estimateTokens(CHAT_SYSTEM_PROMPT) +
    estimateTokens(contextBlock) +
    estimateTokens(input.userMessage);
  const fittedHistory = fitHistoryToBudget(baseTokens, history, budget);

  return [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    { role: 'user', content: contextBlock },
    ...fittedHistory,
    { role: 'user', content: input.userMessage },
  ];
}
