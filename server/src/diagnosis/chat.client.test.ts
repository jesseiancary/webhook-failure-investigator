import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { type ChatStreamEvent, createOpenAIChatClient } from './chat.client.js';
import type { ChatMessage } from './prompt.js';

// Offline unit test of the streaming chat client. A scripted fake `OpenAI` yields content chunks then
// a trailing usage chunk (as `stream_options.include_usage` produces), so the real streaming logic
// runs deterministically with no key and no network: we assert it emits a `delta` per content chunk,
// accumulates the full answer, reads usage + the resolved model off the trailing chunk, and sends a
// plain streaming request (no response_format, no tools) — the deliberate Phase-6 free-form shape.

// The minimal chunk/request shapes the client actually reads. Kept local and loose so the fake stays
// small; the real SDK's ChatCompletionChunk is far wider than streamChat touches.
interface ScriptedChunk {
  model?: string;
  choices: Array<{ delta?: { content?: string | null } }>;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}
interface CreateBody {
  model: string;
  messages: Array<{ role: string; content: string | null }>;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  response_format?: unknown;
  tools?: unknown;
}

/** Build a scripted fake OpenAI whose streaming `create` yields the given chunks, recording the request. */
function makeFakeStreamingOpenAI(chunks: ScriptedChunk[]): {
  client: OpenAI;
  bodies: CreateBody[];
} {
  const bodies: CreateBody[] = [];
  const create = async (body: CreateBody): Promise<AsyncIterable<ScriptedChunk>> => {
    bodies.push(body);
    return (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();
  };
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return { client, bodies };
}

const messages: ChatMessage[] = [
  { role: 'system', content: 'chat system prompt' },
  { role: 'user', content: 'PRIOR DIAGNOSIS …\nDELIVERY HISTORY — 1 attempt(s)' },
  { role: 'user', content: 'Why not a network issue?' },
];

/** A content stream of two deltas followed by the trailing usage chunk (choices empty). */
function scriptedAnswerStream(): ScriptedChunk[] {
  return [
    { model: 'gpt-6-luna', choices: [{ delta: { content: 'Because ' } }] },
    { model: 'gpt-6-luna', choices: [{ delta: { content: 'the 401 names an expired key.' } }] },
    { model: 'gpt-6-luna', choices: [], usage: { prompt_tokens: 1500, completion_tokens: 25 } },
  ];
}

async function collect(stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('createOpenAIChatClient streaming', () => {
  it('emits a delta per content chunk, then a done with the full answer, model, and usage', async () => {
    const { client } = makeFakeStreamingOpenAI(scriptedAnswerStream());

    const events = await collect(
      createOpenAIChatClient({ client, model: 'gpt-6-luna' }).streamChat(messages),
    );

    expect(events).toEqual([
      { type: 'delta', text: 'Because ' },
      { type: 'delta', text: 'the 401 names an expired key.' },
      {
        type: 'done',
        content: 'Because the 401 names an expired key.',
        model: 'gpt-6-luna',
        usage: { promptTokens: 1500, completionTokens: 25 },
      },
    ]);
  });

  it('sends a plain streaming request: stream + include_usage, no response_format, no tools', async () => {
    const { client, bodies } = makeFakeStreamingOpenAI(scriptedAnswerStream());

    await collect(createOpenAIChatClient({ client, model: 'gpt-6-luna' }).streamChat(messages));

    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    expect(body.model).toBe('gpt-6-luna');
    expect(body.stream).toBe(true);
    expect(body.stream_options?.include_usage).toBe(true);
    // Free-form by design — the Phase-6 chat path advertises neither structured output nor tools.
    expect(body.response_format).toBeUndefined();
    expect(body.tools).toBeUndefined();
    // The assembled context is mapped onto OpenAI messages (system + context + question).
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'user']);
  });

  it('prefers the resolved model snapshot and warns (but does not throw) on a missing usage chunk', async () => {
    // The API may resolve an alias to a dated snapshot and (defensively) omit usage; the client should
    // report the echoed model and fall back to zeroed usage rather than throwing. Because content was
    // produced with no usage, it must WARN — a silent zero would undercount the turn's cost.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = makeFakeStreamingOpenAI([
      { model: 'gpt-6-luna-2026-01-01', choices: [{ delta: { content: 'Answer.' } }] },
    ]);

    const events = await collect(
      createOpenAIChatClient({ client, model: 'gpt-6-luna' }).streamChat(messages),
    );

    expect(events.at(-1)).toEqual({
      type: 'done',
      content: 'Answer.',
      model: 'gpt-6-luna-2026-01-01',
      usage: { promptTokens: 0, completionTokens: 0 },
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('gpt-6-luna-2026-01-01');
    warn.mockRestore();
  });

  it('does not warn when the usage chunk is present', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = makeFakeStreamingOpenAI(scriptedAnswerStream());

    await collect(createOpenAIChatClient({ client, model: 'gpt-6-luna' }).streamChat(messages));

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
