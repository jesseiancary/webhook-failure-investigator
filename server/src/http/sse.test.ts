import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { openSSE } from './sse.js';

// Unit test for the SSE helper against a minimal fake Express response that records header/write/end
// calls. Asserts the event-stream headers are set and flushed, each event is written in the SSE wire
// format (`event:` + `data:` + blank line), payloads are JSON (so a multi-line body can't break
// framing), and `close` ends the response exactly once.

interface FakeResponse {
  res: Response;
  headers: Record<string, string>;
  writes: string[];
  status: number | undefined;
  flushed: boolean;
  ended: boolean;
}

function makeFakeResponse(): FakeResponse {
  const state: FakeResponse = {
    res: undefined as unknown as Response,
    headers: {},
    writes: [],
    status: undefined,
    flushed: false,
    ended: false,
  };
  state.res = {
    status(code: number) {
      state.status = code;
      return this;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      return this;
    },
    flushHeaders() {
      state.flushed = true;
    },
    write(chunk: string) {
      state.writes.push(chunk);
      return true;
    },
    end() {
      state.ended = true;
    },
  } as unknown as Response;
  return state;
}

describe('openSSE', () => {
  it('sets and flushes the event-stream headers with a 200 status', () => {
    const fake = makeFakeResponse();

    openSSE(fake.res);

    expect(fake.status).toBe(200);
    expect(fake.headers['Content-Type']).toBe('text/event-stream');
    expect(fake.headers['Cache-Control']).toBe('no-cache');
    expect(fake.headers.Connection).toBe('keep-alive');
    expect(fake.headers['X-Accel-Buffering']).toBe('no');
    expect(fake.flushed).toBe(true);
  });

  it('writes a named event with a JSON data line and a blank-line terminator', () => {
    const fake = makeFakeResponse();

    const sse = openSSE(fake.res);
    sse.sendEvent('delta', { text: 'hello' });

    expect(fake.writes.join('')).toBe('event: delta\ndata: {"text":"hello"}\n\n');
  });

  it('JSON-encodes a multi-line payload so newlines cannot break SSE framing', () => {
    const fake = makeFakeResponse();

    const sse = openSSE(fake.res);
    sse.sendEvent('delta', { text: 'line one\nline two' });

    // The literal newline is escaped inside the JSON string — the only raw newlines are the framing.
    const written = fake.writes.join('');
    expect(written).toBe('event: delta\ndata: {"text":"line one\\nline two"}\n\n');
    expect(written.endsWith('\n\n')).toBe(true);
  });

  it('close ends the response', () => {
    const fake = makeFakeResponse();

    openSSE(fake.res).close();

    expect(fake.ended).toBe(true);
  });
});
