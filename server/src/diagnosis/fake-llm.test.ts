import type OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ChatStreamEvent, createOpenAIChatClient } from './chat.client.js';
import { createOpenAIDiagnosisClient } from './openai.js';
import type { ChatMessage } from './prompt.js';

// The fake LLM clients are wired into the real factories behind `WFI_FAKE_LLM=1` (env.FAKE_LLM), so
// the Phase 7 e2e can run the whole stack with no key and no network. These tests lock the gating:
// the fake activates ONLY under the flag, and an explicitly injected client always wins over it (so
// the flag can never silently fake a key-gated live-call test). The real network path is never hit —
// the "not faked" cases inject a sentinel client that throws, proving control reached the real loop.

// A sentinel OpenAI whose first call throws, so "we took the real path" is observable without a key.
function sentinelDiagnosisClient(message: string): OpenAI {
  return {
    chat: {
      completions: {
        parse: async () => {
          throw new Error(message);
        },
      },
    },
  } as unknown as OpenAI;
}

function sentinelChatClient(message: string): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error(message);
        },
      },
    },
  } as unknown as OpenAI;
}

async function collect(stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

const messages: ChatMessage[] = [{ role: 'user', content: 'investigate' }];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createOpenAIDiagnosisClient fake gating', () => {
  it('returns the deterministic fake when WFI_FAKE_LLM=1 and no client is injected', async () => {
    vi.stubEnv('WFI_FAKE_LLM', '1');

    const result = await createOpenAIDiagnosisClient().runDiagnosis(messages);

    expect(result.model).toBe('fake-llm');
    expect(result.diagnosis.failureCategory).toBe('authentication');
    expect(result.diagnosis.evidence[0]?.field).toBe('attempts[0].responseStatus');
    expect(result.toolCalls).toEqual([]);
  });

  it('honors an injected client even when the flag is set (injected wins)', async () => {
    vi.stubEnv('WFI_FAKE_LLM', '1');

    const client = createOpenAIDiagnosisClient({ client: sentinelDiagnosisClient('REAL_PATH') });

    await expect(client.runDiagnosis(messages)).rejects.toThrow('REAL_PATH');
  });

  it('does not fake when the flag is unset', async () => {
    vi.stubEnv('WFI_FAKE_LLM', '');

    const client = createOpenAIDiagnosisClient({ client: sentinelDiagnosisClient('REAL_PATH') });

    await expect(client.runDiagnosis(messages)).rejects.toThrow('REAL_PATH');
  });
});

describe('createOpenAIChatClient fake gating', () => {
  it('returns the deterministic fake stream when WFI_FAKE_LLM=1 and no client is injected', async () => {
    vi.stubEnv('WFI_FAKE_LLM', '1');

    const events = await collect(createOpenAIChatClient().streamChat(messages));

    expect(events.filter((e) => e.type === 'delta').length).toBeGreaterThan(0);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', model: 'fake-llm' });
  });

  it('honors an injected client even when the flag is set (injected wins)', async () => {
    vi.stubEnv('WFI_FAKE_LLM', '1');

    const client = createOpenAIChatClient({ client: sentinelChatClient('REAL_CHAT_PATH') });

    await expect(collect(client.streamChat(messages))).rejects.toThrow('REAL_CHAT_PATH');
  });
});
