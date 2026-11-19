import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { logger } from '../logging/logger.js';

// Lightweight admin auth gate (Phase 10, B6) for the one genuinely administrative write —
// POST /capture-endpoints, which mints public ingest URLs. The open-demo model (CLAUDE.md / plan)
// keeps investigate/chat/manual-submit public (governed by rate limiting + the daily cost cap); only
// endpoint minting is bearer-token gated.
//
// When ADMIN_API_TOKEN is unset (local dev, tests) the gate no-ops so the dev loop and the HTTP
// integration tests are unaffected; in production the token is set and required. A one-time warning
// makes the open state visible in logs rather than silent.

let warnedOpen = false;

/** Constant-time compare of two secrets, length-safe (timingSafeEqual throws on length mismatch). */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Compare equal-length buffers only; a length difference is a non-match but must not throw. Hash
  // both to a fixed width first so the comparison itself is constant-time regardless of input length.
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

/** Extract the token from an `Authorization: Bearer <token>` header, or null if absent/malformed. */
function bearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Express middleware guarding an admin write. Set `ADMIN_API_TOKEN` to enable it; leave it unset to
 * keep the route open (dev/test). A missing or wrong bearer token is a 401 in the standard envelope.
 */
export const requireAdmin: RequestHandler = (req, res, next) => {
  const expected = env.ADMIN_API_TOKEN;
  if (expected === undefined) {
    if (!warnedOpen) {
      logger.warn(
        'ADMIN_API_TOKEN is unset — POST /capture-endpoints is UNAUTHENTICATED (expected in local dev; set it in production).',
      );
      warnedOpen = true;
    }
    next();
    return;
  }

  const provided = bearerToken(req.headers.authorization);
  if (provided === null || !tokensMatch(provided, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};
