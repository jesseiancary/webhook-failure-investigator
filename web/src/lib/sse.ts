import { ApiError, type ApiErrorBody } from '../api/client';

// Client for the streaming follow-up chat endpoint (`POST /investigations/:id/chat`), consumed as
// Server-Sent Events. `EventSource` can't issue a POST with a body, so we drive the stream by hand:
// fetch the response, read `response.body` as a stream, and parse the SSE wire format the server
// writes (see server/src/http/sse.ts) — `event:` + `data:` lines, frames separated by a blank line.
//
// The 4xx preconditions (400 bad body, 404 unknown investigation) come back as ordinary JSON BEFORE
// the stream opens, so a non-OK response is surfaced as an ApiError, matching api/client.ts. Faults
// once the stream is open arrive as a terminal `error` event, not an HTTP status.

/** The `usage` block on the terminal `done` event (mirrors the server's ChatUsage). */
export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

/** The payload of the terminal `done` SSE event — the persisted answer's id plus per-turn accounting. */
export interface ChatDonePayload {
  investigationId: string;
  messageId: string;
  model: string;
  usage: ChatUsage;
  costUsd: string;
}

/** Callbacks the caller provides to react to the stream as it unfolds. */
export interface ChatStreamHandlers {
  /** A token (or run of tokens) of the answer; append it to the live message. */
  onDelta(text: string): void;
  /** The stream finished cleanly; carries the final model/usage/cost. */
  onDone(payload: ChatDonePayload): void;
  /** The server reported a mid-stream failure (opaque by design). */
  onError(message: string): void;
}

/** Split a raw SSE frame (`event: x\ndata: y`) into its event name and parsed JSON data. */
function parseFrame(frame: string): { event: string; data: unknown } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

/**
 * Stream one chat turn. Resolves when the stream closes (after `onDone`/`onError` has fired, or the
 * socket simply ends); rejects with an ApiError if the request fails its precondition before the
 * stream opens. Pass an `AbortSignal` to cancel an in-flight turn (e.g. on unmount).
 */
export async function streamChat(
  investigationId: string,
  message: string,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/investigations/${encodeURIComponent(investigationId)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!res.ok) {
    let body: ApiErrorBody;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      body = { error: res.statusText || 'RequestFailed' };
    }
    throw new ApiError(res.status, body);
  }
  if (!res.body) {
    throw new ApiError(res.status, { error: 'EmptyStream' });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (frame: string): void => {
    const parsed = parseFrame(frame);
    if (!parsed) return;
    if (parsed.event === 'delta') {
      handlers.onDelta((parsed.data as { text: string }).text);
    } else if (parsed.event === 'done') {
      handlers.onDone(parsed.data as ChatDonePayload);
    } else if (parsed.event === 'error') {
      const detail = (parsed.data as { error?: string }).error;
      handlers.onError(detail ?? 'ChatStreamFailed');
    }
  };

  // Accumulate bytes and emit each complete frame (terminated by a blank line) as it arrives, so
  // deltas render token-by-token rather than all at once when the stream closes.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      dispatch(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
  }
  // Flush a trailing frame with no blank-line terminator (a stream that ends mid-frame).
  if (buffer.trim().length > 0) {
    dispatch(buffer);
  }
}
