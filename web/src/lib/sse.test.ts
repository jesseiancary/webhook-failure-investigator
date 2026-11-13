import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { type ChatStreamHandlers, streamChat } from './sse';

// The SSE client drives the follow-up chat by hand (EventSource can't POST). These tests pin the wire
// parsing: deltas accumulate token-by-token even when a frame is split across reads, `done` carries
// the per-turn accounting, a mid-stream `error` frame surfaces via onError, and a 4xx precondition
// before the stream opens throws an ApiError rather than a silent failure.

/** A fake streaming Response whose body yields the given byte chunks in order. */
function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const encoded = chunks.map((c) => encoder.encode(c));
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: () =>
          i < encoded.length
            ? Promise.resolve({ done: false, value: encoded[i++] })
            : Promise.resolve({ done: true, value: undefined }),
      }),
    },
  } as unknown as Response;
}

function handlers(): ChatStreamHandlers & {
  deltas: string[];
  done: unknown[];
  errors: string[];
} {
  const deltas: string[] = [];
  const done: unknown[] = [];
  const errors: string[] = [];
  return {
    deltas,
    done,
    errors,
    onDelta: (text) => deltas.push(text),
    onDone: (payload) => done.push(payload),
    onError: (message) => errors.push(message),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamChat', () => {
  it('accumulates delta frames and reports the terminal done payload', async () => {
    const h = handlers();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          streamingResponse([
            'event: delta\ndata: {"text":"Hello"}\n\n',
            'event: delta\ndata: {"text":" world"}\n\n',
            'event: done\ndata: {"investigationId":"i1","messageId":"m1","model":"fake-llm","usage":{"promptTokens":10,"completionTokens":2},"costUsd":"0.0000"}\n\n',
          ]),
        ),
    );

    await streamChat('i1', 'why?', h);

    expect(h.deltas).toEqual(['Hello', ' world']);
    expect(h.done).toEqual([
      {
        investigationId: 'i1',
        messageId: 'm1',
        model: 'fake-llm',
        usage: { promptTokens: 10, completionTokens: 2 },
        costUsd: '0.0000',
      },
    ]);
    expect(h.errors).toEqual([]);
  });

  it('parses frames that are split across read boundaries', async () => {
    const h = handlers();
    vi.stubGlobal(
      'fetch',
      // The first delta frame arrives in two separate reads, no blank-line terminator until read 2.
      vi
        .fn()
        .mockResolvedValue(
          streamingResponse([
            'event: delta\ndata: {"text":"par',
            'tial"}\n\nevent: delta\ndata: {"text":"!"}\n\n',
          ]),
        ),
    );

    await streamChat('i1', 'why?', h);

    expect(h.deltas).toEqual(['partial', '!']);
  });

  it('surfaces a mid-stream error frame via onError', async () => {
    const h = handlers();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          streamingResponse(['event: error\ndata: {"error":"ChatStreamFailed"}\n\n']),
        ),
    );

    await streamChat('i1', 'why?', h);

    expect(h.errors).toEqual(['ChatStreamFailed']);
    expect(h.done).toEqual([]);
  });

  it('throws an ApiError when the precondition fails before the stream opens', async () => {
    const h = handlers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ error: 'NotFound' }),
      } as unknown as Response),
    );

    await expect(streamChat('missing', 'why?', h)).rejects.toBeInstanceOf(ApiError);
    expect(h.deltas).toEqual([]);
    expect(h.done).toEqual([]);
  });
});
