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

// Value-shape patterns catching credentials by what they LOOK like, not where they sit — so a
// real secret under an unknown key (`charge_token`, `X-Custom`) is still stripped. Only
// high-confidence, purpose-built formats are listed: provider key prefixes, JWTs, Bearer
// tokens, and PEM blocks. We deliberately do NOT score entropy — random-looking event/request/
// idempotency IDs are legitimate log evidence, and over-redacting them would starve the
// grounded diagnosis (the project's core rule). Matched against string values only.
const SECRET_VALUE_PATTERNS = [
  // JSON Web Token: three base64url segments; the header segment begins `eyJ` (i.e. `{"`).
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/,
  // PEM-encoded private key block.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // Bearer credential: the opaque token after the scheme (anchored so prose like
  // "Bearer token required" — which has a space in the remainder — does not match).
  /^Bearer\s+[A-Za-z0-9._~+/-]{10,}={0,2}$/i,
  // Stripe-style keyed secrets: (s|p|r|x)k_(live|test)_…
  /\b[sprx]k_(?:live|test)_[A-Za-z0-9]{8,}\b/,
  // OpenAI-style API keys: sk-… (optionally sk-proj-…).
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  // Webhook signing secret: whsec_…
  /\bwhsec_[A-Za-z0-9]{8,}\b/,
  // GitHub tokens (ghp_/gho_/ghu_/ghs_/ghr_) and fine-grained PATs (github_pat_…).
  /\bgh[opsur]_[A-Za-z0-9]{16,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  // Slack tokens: xoxb-/xoxp-/xoxa-/xoxr-/xoxs-…
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  // AWS access key id.
  /\bAKIA[0-9A-Z]{16}\b/,
  // Google API key.
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];

function isSecretValue(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/** True when a header value — or any element of an array value — looks like a credential. */
function headerValueIsSecret(value: string | string[]): boolean {
  return (Array.isArray(value) ? value : [value]).some(isSecretValue);
}

/**
 * Redact secret-bearing headers. A header is redacted when its NAME is a known secret header
 * (`isSecretHeaderName`) or its VALUE looks like a credential (`headerValueIsSecret`) — the
 * latter closes the gap of a secret sent under an innocuous header name. Returns a new map;
 * array values (e.g. Set-Cookie) are replaced wholesale with a single `[REDACTED]` marker so
 * no fragment leaks.
 */
export function redactHeaders(headers: HeaderMap): HeaderMap {
  const result: HeaderMap = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name] = isSecretHeaderName(name) || headerValueIsSecret(value) ? REDACTED : value;
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
 * Recursively redact secret-valued fields in an arbitrary JSON value. A value is redacted when
 * its KEY is a known secret field (`isSecretBodyKey`) or, for string leaves, when the VALUE
 * itself looks like a credential (`isSecretValue`) — the latter catches a secret stored under
 * an unknown key name. Objects and arrays are walked; non-string primitives (number, boolean,
 * null, undefined) pass through so numeric/boolean evidence like `tokenCount` survives. Returns
 * new objects/arrays.
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
  if (typeof value === 'string' && isSecretValue(value)) {
    return REDACTED;
  }
  return value;
}
