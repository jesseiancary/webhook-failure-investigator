import type { Response } from 'express';

// Minimal Server-Sent Events helper — the first streaming-response primitive in the codebase (Phase
// 6 chat is the first endpoint that streams). `openSSE` flips a normal Express response into an SSE
// channel: it sets the event-stream headers, flushes them so the client sees the stream open
// immediately, and returns `sendEvent`/`close` for the route to drive. Each event is written in the
// SSE wire format (`event:` line + `data:` line + blank-line terminator); payloads are JSON so a
// multi-line body never breaks framing (JSON.stringify has no raw newlines).

/** A live SSE channel over one HTTP response. `sendEvent` emits a named event; `close` ends the stream. */
export interface SSEChannel {
  /** Emit a named SSE event whose `data` is the JSON-encoded payload. */
  sendEvent(event: string, data: unknown): void;
  /** End the response, closing the stream. Idempotent-safe to call once in a `finally`. */
  close(): void;
}

/**
 * Turn `res` into an SSE stream: set the event-stream headers and flush them so the connection opens
 * before the first event, then return the channel the route writes to. `X-Accel-Buffering: no` tells
 * an intermediary (nginx) not to buffer the stream, so deltas reach the client as they are produced.
 * Call this only after any 4xx precondition has been handled — once the 200 + stream headers are
 * flushed the status is committed, so 404/400 must stay ordinary JSON responses sent before `openSSE`.
 */
export function openSSE(res: Response): SSEChannel {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  return {
    sendEvent(event: string, data: unknown): void {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    close(): void {
      res.end();
    },
  };
}
