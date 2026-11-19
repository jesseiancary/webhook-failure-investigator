import type { NextFunction, Request, RequestHandler, Response } from 'express';
import OpenAI from 'openai';
import { DailyBudgetExceededError } from '../diagnosis/cost-guard.js';
import { logger } from '../logging/logger.js';

/**
 * Wrap an async route handler so rejected promises reach Express's error pipeline instead of
 * hanging the request. Express 4 does not await handlers, so this forwards errors to next().
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

// Stable response labels for the client-error statuses we deliberately surface. Anything not
// listed falls through to a generic InternalServerError so no internal detail leaks.
const CLIENT_ERROR_LABELS: Record<number, string> = {
  400: 'BadRequest',
  413: 'PayloadTooLarge',
};

/** Read a numeric HTTP status off an error thrown upstream (e.g. body-parser's SyntaxError). */
function clientErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const raw =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  return typeof raw === 'number' && raw >= 400 && raw <= 499 ? raw : undefined;
}

/**
 * Terminal error middleware. Client errors thrown upstream — malformed JSON (400) or an oversized
 * body (413) from `express.json` — are reported with their own 4xx status; everything else is a
 * 500. Internal error detail is never echoed to the response. Only genuine 5xx faults are logged
 * (via the shared pino logger) so expected client errors don't masquerade as server faults; the log
 * carries the error's message + stack only — never `req.body`/`req.headers` — so no payload or auth
 * material can ride along in a fault log (Phase 10, B8). All four parameters are kept so Express
 * treats this as an error handler (unused ones are `_`-prefixed to satisfy noUnusedParameters).
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // The daily demo budget is exhausted (Phase 10, B7): a friendly 429 in the standard envelope, with a
  // human-readable `message` the UI surfaces directly. Not a fault — logged at info, not error.
  if (err instanceof DailyBudgetExceededError) {
    logger.info({ spentUsd: err.spentUsd, capUsd: err.capUsd }, 'daily cost cap reached');
    res.status(429).json({ error: 'DailyBudgetReached', message: err.message });
    return;
  }

  // An error from the OpenAI SDK (auth, rate limit, connection, or 5xx) is an UPSTREAM dependency
  // failure — not a fault in the caller's request. Surface it as a 502 so it isn't mislabeled a
  // client error: `clientErrorStatus` below would otherwise pass OpenAI's 4xx (e.g. a 401 from a
  // bad OPENAI_API_KEY) straight through as a confusing `BadRequest`. The upstream status/type is
  // logged for operators; the error's message is deliberately not logged or echoed, so no key
  // fragment OpenAI may include in it can leak.
  if (err instanceof OpenAI.APIError) {
    logger.error(
      { err: { status: err.status, type: err.type, code: err.code } },
      'openai upstream error',
    );
    res.status(502).json({
      error: 'UpstreamServiceError',
      message: 'The diagnosis service is temporarily unavailable. Please try again shortly.',
    });
    return;
  }

  const status = clientErrorStatus(err);
  if (status !== undefined) {
    res.status(status).json({ error: CLIENT_ERROR_LABELS[status] ?? 'BadRequest' });
    return;
  }
  logger.error(
    err instanceof Error ? { err: { message: err.message, stack: err.stack } } : { err },
    'unhandled request error',
  );
  res.status(500).json({ error: 'InternalServerError' });
}
