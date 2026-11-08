// Secret redaction — the project's core invariant: strip auth headers, tokens, and
// signatures BEFORE anything is persisted or logged (see CLAUDE.md). Every ingest path
// funnels through here via events.service. All functions are pure, non-mutating, and
// idempotent: they return new values and never touch the caller's request objects.

export const REDACTED = '[REDACTED]';

/** A header map as received from an HTTP layer — values may be arrays (e.g. Set-Cookie). */
export type HeaderMap = Record<string, string | string[]>;

// Exact header names to redact (compared case-insensitively — HTTP header names are
// case-insensitive).
const HEADER_NAME_DENYLIST = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-webhook-secret',
]);

// Substring/suffix patterns that catch provider-specific secret headers regardless of
// exact spelling: Stripe-Signature, X-Hub-Signature-256, X-Slack-Signature, X-*-Secret,
// *-Api-Key, *-Token, etc. Matched against the lowercased header name.
const HEADER_NAME_PATTERNS = [/signature/, /secret/, /api-key/, /-token$/];

function isSecretHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  if (HEADER_NAME_DENYLIST.has(lower)) return true;
  return HEADER_NAME_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * Redact secret-bearing headers by name. Returns a new map; array values (e.g. Set-Cookie)
 * are replaced wholesale with a single `[REDACTED]` marker so no fragment leaks.
 */
export function redactHeaders(headers: HeaderMap): HeaderMap {
  const result: HeaderMap = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name] = isSecretHeaderName(name) ? REDACTED : value;
  }
  return result;
}

// Exact body keys (compared case-insensitively) whose values are secrets. Exact-match, not
// substring: over-redaction would strip the very log evidence a grounded diagnosis must cite.
const BODY_KEY_DENYLIST = new Set([
  'password',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'client_secret',
  'authorization',
  'signature',
  'private_key',
]);

function isSecretBodyKey(key: string): boolean {
  return BODY_KEY_DENYLIST.has(key.toLowerCase());
}

/**
 * Recursively redact secret-valued fields in an arbitrary JSON value. Objects and arrays are
 * walked; a matching key's value is replaced with `[REDACTED]`. Non-object inputs (string,
 * number, boolean, null, undefined) are returned unchanged. Returns new objects/arrays.
 */
export function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = isSecretBodyKey(key) ? REDACTED : redactJson(val);
    }
    return result;
  }
  return value;
}
