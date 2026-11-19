import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import { env } from '../config/env.js';

// Per-IP rate limiting (Phase 10, B5). Tiered so the expensive, OpenAI-spending endpoints are the
// strictest, the public webhook-ingest path is middling, and a loose global limiter backstops
// everything else. Keying on the real client IP requires `app.set('trust proxy', 1)` (set in app.ts)
// so Railway's edge-proxied `X-Forwarded-For` is trusted.
//
// Store: the default in-memory store — fine for a single Railway instance, and it simply resets on
// redeploy. A Redis-backed store is the multi-instance upgrade (out of scope for a single demo
// instance); swap it in here if the deploy ever scales horizontally.

const HOUR_MS = 60 * 60 * 1000;

// The integration suite fires bursts of investigate/chat/capture requests (often sharing one test IP)
// that would otherwise trip these limits and make tests flaky; disable enforcement under NODE_ENV=test.
// The 429 path itself is covered directly in rate-limit.test.ts against a low-limit instance.
const skipInTest = (): boolean => env.NODE_ENV === 'test';

/**
 * Build a per-IP limiter that returns the app's standard error envelope on 429. `skip` defaults to
 * disabling enforcement under NODE_ENV=test (so integration bursts don't trip it); rate-limit.test.ts
 * passes its own `skip` to exercise the real 429 path deterministically.
 */
export function createJsonLimiter(opts: {
  windowMs: number;
  limit: number;
  skip?: () => boolean;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: opts.skip ?? skipInTest,
    // Match the app's standard error envelope (http/error-handler.ts): `{ error: <Label> }`.
    handler: (_req, res) => {
      res.status(429).json({ error: 'TooManyRequests' });
    },
  });
}

/** Loose catch-all limiter mounted on every route. */
export const globalLimiter: RateLimitRequestHandler = createJsonLimiter({
  windowMs: HOUR_MS,
  limit: 600,
});

/**
 * Strict limiter for the paid, OpenAI-spending endpoints (POST /events/:id/investigate and
 * POST /investigations/:id/chat). This is the per-IP complement to the global daily cost cap (B7):
 * the cap bounds total spend, this bounds how fast one client can drive it.
 */
export const paidLimiter: RateLimitRequestHandler = createJsonLimiter({
  windowMs: HOUR_MS,
  limit: 30,
});

/** Limiter for the public webhook-ingest endpoint (POST /capture/:token). */
export const captureLimiter: RateLimitRequestHandler = createJsonLimiter({
  windowMs: HOUR_MS,
  limit: 120,
});
