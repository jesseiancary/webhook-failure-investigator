import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { env } from '../config/env.js';

// Structured logging (Phase 10, B8). One shared pino instance replaces the raw `console.*` calls that
// recon flagged as the only realistic log-leak path. Two guarantees matter here and are tested:
//   1. Request-header logging can NEVER emit auth material — the `redact` paths below mirror
//      ingest/redact.ts's header denylist, so pino-http's auto-serialized `req.headers.*` are scrubbed
//      before they are ever written, independent of the storage-side redaction.
//   2. Callers log message + stack only, never whole `req.body`/`req.headers` objects (see
//      error-handler.ts / chat.routes.ts), so no unredacted payload can ride along in an error log.

// Header paths pino redacts on every log record. These mirror redactHeaders()'s denylist; pino's
// `redact` matches literal paths (not the regex patterns redact.ts also applies), so this is the
// exact-name subset — the broad signature/secret/token patterns never reach a log because we never
// log the full header object outside pino-http's serialized `req`, which these paths cover. Both the
// lower-case and canonical casings are listed because Node lower-cases request headers but a
// hand-built log object might not.
const REDACT_HEADER_PATHS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-webhook-secret',
];

/**
 * The redact paths for pino, derived from the denylist. pino-http serializes request headers onto
 * `req.headers.*` (and response headers onto `res.headers.*`); dashed names need the bracket form.
 */
export function redactPaths(): string[] {
  return REDACT_HEADER_PATHS.flatMap((name) => [
    `req.headers["${name}"]`,
    `res.headers["${name}"]`,
  ]);
}

/**
 * The process-wide logger. In production it emits newline-delimited JSON (the format platform log
 * drains expect); in dev it stays JSON too (no `pino-pretty` dependency) but at `debug` level. Test
 * runs are silenced so Vitest output stays clean.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug',
  // Never let an auth header reach a log line, even when a whole `req` is serialized by pino-http.
  redact: { paths: redactPaths(), censor: '[REDACTED]' },
});

/**
 * Express request-logging middleware. Mounted early in app.ts so every request/response is logged
 * once with method, path, status, and duration — with the auth headers above already redacted. Kept
 * out of the test environment's output by the `silent` level above.
 */
export const httpLogger = pinoHttp({ logger });
