import type { NextFunction, Request, RequestHandler, Response } from 'express';

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
 * 500. Internal error detail is never echoed to the response. Detailed logging (pino) arrives in a
 * later phase; for now only genuine 5xx faults are logged so expected client errors don't masquerade
 * as server faults. All four parameters are kept so Express treats this as an error handler
 * (unused ones are `_`-prefixed to satisfy noUnusedParameters).
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = clientErrorStatus(err);
  if (status !== undefined) {
    res.status(status).json({ error: CLIENT_ERROR_LABELS[status] ?? 'BadRequest' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'InternalServerError' });
}
