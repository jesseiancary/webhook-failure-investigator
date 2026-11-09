// Shared serialization: turn a redacted webhook event + its delivery attempts into a stable,
// token-lean, citable text block. Extracted from the Phase-4 prompt (buildUserMessage) so the
// Phase-5 retrieval tools (get_event_payload, get_delivery_history) emit byte-identical field
// paths. That identity is load-bearing: a diagnosis's `evidence[].field` citations must resolve the
// same way regardless of whether the data reached the model inline or via a tool call.

// A structural view of the redacted event/attempt the serializer needs. Deliberately looser than the
// Prisma row (optional, `| null`) so a `getEventById` result, a `deliveryAttempt.findMany` row, and
// hand-authored few-shot fixtures all satisfy it without ceremony.
export interface SerializableAttempt {
  requestUrl: string;
  requestMethod: string;
  requestHeaders: unknown;
  requestBody?: unknown;
  responseStatus?: number | null;
  responseHeaders?: unknown;
  responseBody?: unknown;
  latencyMs?: number | null;
  errorText?: string | null;
  attemptedAt?: Date | string | null;
}

export interface SerializableEvent {
  source: string;
  eventType: string;
  payload: unknown;
  headers: unknown;
  attempts: SerializableAttempt[];
}

/** Render a log value for the prompt: `(absent)` for null/undefined, raw for strings, compact JSON otherwise. */
export function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '(absent)';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/**
 * Serialize one delivery attempt into labeled, citable lines, each prefixed with its exact field
 * path (`attempts[i].responseStatus`, …). A leading blank line separates it from the preceding
 * block. Absent response fields render as `(absent)` rather than being dropped — their absence is
 * itself diagnostic (it's the insufficient_evidence signal).
 */
export function serializeAttempt(attempt: SerializableAttempt, index: number): string[] {
  const p = `attempts[${index}]`;
  return [
    '',
    `${p}.attemptedAt: ${formatValue(attempt.attemptedAt)}`,
    `${p}.requestMethod: ${formatValue(attempt.requestMethod)}`,
    `${p}.requestUrl: ${formatValue(attempt.requestUrl)}`,
    `${p}.requestHeaders: ${formatValue(attempt.requestHeaders)}`,
    `${p}.requestBody: ${formatValue(attempt.requestBody)}`,
    `${p}.responseStatus: ${formatValue(attempt.responseStatus)}`,
    `${p}.responseHeaders: ${formatValue(attempt.responseHeaders)}`,
    `${p}.responseBody: ${formatValue(attempt.responseBody)}`,
    `${p}.latencyMs: ${formatValue(attempt.latencyMs)}`,
    `${p}.errorText: ${formatValue(attempt.errorText)}`,
  ];
}

/** Serialize every attempt in order, each as its own citable block (see `serializeAttempt`). */
export function serializeAttempts(attempts: SerializableAttempt[]): string[] {
  return attempts.flatMap((attempt, index) => serializeAttempt(attempt, index));
}
