import type OpenAI from 'openai';
import { env } from '../config/env.js';
import { createFakeChatClient } from './fake-llm.js';
import { getOpenAI, toOpenAIMessage } from './openai.js';
import type { ChatMessage } from './prompt.js';

// The OpenAI seam for Phase-6 follow-up chat — the streaming twin of `DiagnosisClient`. Where
// diagnosis runs a bounded tool-calling loop against Structured Outputs, chat is deliberately plain:
// the context is already assembled (prior diagnosis + logs + history, built by chat.context.ts), so
// this just streams a free-form, grounded answer. No `response_format`, no tools, default reasoning —
// which also sidesteps the Phase-5 `reasoning_effort: 'none'` tool constraint entirely. The `client`
// seam lets tests inject a scripted fake stream; production gets the shared lazy OpenAI singleton.

/** Token usage for one chat turn, read from the stream's trailing `include_usage` chunk. */
export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * One event from a streamed chat turn: a `delta` carries the next text chunk; a single terminal
 * `done` carries the fully accumulated answer plus the model and token usage the caller needs to
 * persist the per-turn accounting (CLAUDE.md rule) and emit the final SSE event.
 */
export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; content: string; model: string; usage: ChatUsage };

/** The subset of behavior the chat service needs; implemented for real by OpenAI and by a test stub. */
export interface ChatClient {
  streamChat(messages: ChatMessage[]): AsyncIterable<ChatStreamEvent>;
}

/**
 * The production `ChatClient`: streams a free-form completion from OpenAI, yielding each content delta
 * as it arrives and a terminal `done` once the stream closes. `stream_options.include_usage` asks the
 * API for a trailing usage chunk (whose `choices` is empty) so the turn carries real token counts for
 * cost accounting — the char-based estimate in token-budget.ts only sizes the request, never bills it.
 * `opts` mirrors `createOpenAIDiagnosisClient`'s DI seam: the key-gated live test can inject a real
 * client / override the model, the offline test injects a scripted fake; production passes nothing and
 * gets the shared singleton + `env.OPENAI_CHAT_MODEL`.
 */
export function createOpenAIChatClient(opts?: { client?: OpenAI; model?: string }): ChatClient {
  // Offline/e2e mode: return a deterministic fake so the stack runs with no key and no network. An
  // explicitly injected client (the key-gated live test) still wins over the flag.
  if (opts?.client == null && env.FAKE_LLM) {
    return createFakeChatClient();
  }

  const model = opts?.model ?? env.OPENAI_CHAT_MODEL;

  return {
    async *streamChat(messages: ChatMessage[]): AsyncIterable<ChatStreamEvent> {
      const client = opts?.client ?? getOpenAI();
      const stream = await client.chat.completions.create({
        model,
        messages: messages.map(toOpenAIMessage),
        stream: true,
        stream_options: { include_usage: true },
      });

      let content = '';
      let usage: ChatUsage = { promptTokens: 0, completionTokens: 0 };
      let sawUsage = false;
      // Default to the requested model, but prefer the resolved snapshot the API echoes on each chunk
      // (e.g. an alias resolving to a dated snapshot) so the persisted `model`/cost are exact.
      let resolvedModel = model;

      for await (const chunk of stream) {
        if (chunk.model) {
          resolvedModel = chunk.model;
        }
        const delta = chunk.choices[0]?.delta?.content;
        if (delta != null && delta !== '') {
          content += delta;
          yield { type: 'delta', text: delta };
        }
        // The trailing usage chunk (choices empty) carries the real token counts.
        if (chunk.usage) {
          sawUsage = true;
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
          };
        }
      }

      // A completed stream that produced text but no usage chunk would persist zero tokens/cost — a
      // silent undercount. Surface it rather than fabricate counts: the char-based estimate is
      // explicitly not for billing (see token-budget.ts), so an honest-but-warned zero is correct,
      // mirroring pricing.ts's warn-and-record-0 for an unknown model.
      if (!sawUsage && content !== '') {
        console.warn(
          `chat: stream for model "${resolvedModel}" returned content but no usage chunk; recording zero tokens/cost for this turn`,
        );
      }

      yield { type: 'done', content, model: resolvedModel, usage };
    },
  };
}
