import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { env } from '../config/env.js';
import { DiagnosisSchema, type Diagnosis } from './diagnosis.schema.js';
import { createFakeDiagnosisClient } from './fake-llm.js';
import type { ChatMessage } from './prompt.js';

// The OpenAI seam for diagnosis. `DiagnosisClient` is the narrow contract the service depends on —
// "given the assembled chat messages and a toolkit, retrieve what you need via tools and return a
// validated diagnosis + token usage + the tool calls made" — so tests inject a deterministic stub
// and never touch the network. The real implementation (`createOpenAIDiagnosisClient`) is the only
// code that talks to OpenAI, and the only place the bounded tool-calling loop lives.

export interface DiagnosisUsage {
  promptTokens: number;
  completionTokens: number;
}

/** A tool call the model made and the result fed back, captured so the service can persist it. */
export interface PersistedToolCall {
  /** The provider-assigned call id. */
  id: string;
  /** The tool/function name the model invoked. */
  name: string;
  /** The raw JSON arguments the model supplied. */
  arguments: string;
  /** The citable text block the tool returned (already redacted). */
  result: string;
}

/**
 * The retrieval toolkit handed to one investigation: the OpenAI function definitions to advertise,
 * and a dispatcher that validates + executes a call by name. Built per-investigation and bound to
 * the event under investigation (see tools/toolkit.ts), so event-scoped tools can never be steered
 * at another event.
 */
export interface DiagnosisToolkit {
  definitions: OpenAI.Responses.FunctionTool[];
  /** Validate `argsJson` and run the named tool, returning its citable text block (or an error block). */
  execute(name: string, argsJson: string): Promise<string>;
}

export interface DiagnosisResult {
  diagnosis: Diagnosis;
  usage: DiagnosisUsage;
  /** The model that produced the diagnosis, recorded on the Investigation for cost/traceability. */
  model: string;
  /** Every tool call made during the loop, in order, for persistence as InvestigationMessages. */
  toolCalls: PersistedToolCall[];
}

/** The subset of behavior the service needs; implemented for real by OpenAI and by a test stub. */
export interface DiagnosisClient {
  runDiagnosis(messages: ChatMessage[], toolkit?: DiagnosisToolkit): Promise<DiagnosisResult>;
}

// The tool-calling loop is bounded so a misbehaving model can't retrieve forever. On exhaustion we
// make one final tool-disabled call, so an investigation always ends in a diagnosis rather than an
// error. Six iterations is comfortably more than the two retrievals (payload + history) a normal
// diagnosis needs, leaving headroom for a fetch_api_docs call or a re-query.
const MAX_TOOL_ITERATIONS = 6;

// Lazy singleton: construct the OpenAI client (which reads the required OPENAI_API_KEY) only on
// first real use, so importing this module — or running the stub-backed tests — never forces the
// key to be present. Cached per process to avoid rebuilding on every investigation.
let openAiSingleton: OpenAI | undefined;

/**
 * The lazily-constructed, process-cached OpenAI client. Exported so the Phase-6 chat client shares
 * one instance (and one key read) with diagnosis rather than standing up a second SDK client.
 */
export function getOpenAI(): OpenAI {
  openAiSingleton ??= new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return openAiSingleton;
}

// Numeric-range JSON-Schema keywords. We deliberately keep these OUT of the schema we send to
// Structured Outputs: whether a given model snapshot's supported-keyword subset accepts them is an
// API-compatibility detail we don't want a first real call to depend on (a rejection would 400 past
// CI, which never runs the key-gated live test). The `confidence ∈ [0,1]` bound still lives in
// DiagnosisSchema and is enforced when the response is parsed, so stripping them here costs nothing.
const NUMERIC_RANGE_KEYWORDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
] as const;

/** Recursively delete numeric-range keywords from every `number`/`integer` node of a JSON schema. */
function stripNumericRangeKeywords(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(stripNumericRangeKeywords);
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  const record = node as Record<string, unknown>;
  // Only strip from an actual numeric schema node, so a field that happens to be *named* e.g.
  // "minimum" (which would sit under `properties`, not as a sibling of `type: number`) is untouched.
  if (record.type === 'number' || record.type === 'integer') {
    for (const keyword of NUMERIC_RANGE_KEYWORDS) {
      delete record[keyword];
    }
  }
  for (const value of Object.values(record)) {
    stripNumericRangeKeywords(value);
  }
}

// Build the Responses-API text format once (the schema is static) and sanitize it in place —
// mutating `schema` preserves the object's auto-parse brand, so `responses.parse` still populates
// `output_parsed` through DiagnosisSchema (which is where the [0,1] bound is enforced).
const DIAGNOSIS_TEXT_FORMAT = (() => {
  const textFormat = zodTextFormat(DiagnosisSchema, 'diagnosis');
  stripNumericRangeKeywords(textFormat.schema);
  return textFormat;
})();

/**
 * Map one internal `ChatMessage` onto the OpenAI messages shape. Exported so the Phase-6 chat client
 * reuses the exact same mapping (its assembled context is plain system/user/assistant turns).
 */
export function toOpenAIMessage(
  message: ChatMessage,
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  // Switch rather than cast so the discriminated-union role stays type-checked.
  switch (message.role) {
    case 'system':
      return { role: 'system', content: message.content };
    case 'user':
      return { role: 'user', content: message.content };
    case 'assistant': {
      // An assistant turn carries either natural-language/JSON content or a set of tool calls (a
      // few-shot replays both shapes); map toolCalls onto the OpenAI `tool_calls` shape when present.
      if (message.toolCalls && message.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: message.content,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
          })),
        };
      }
      return { role: 'assistant', content: message.content };
    }
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
}

/**
 * Map one internal `ChatMessage` onto the Responses-API input shape. Unlike Chat Completions, the
 * Responses API models a tool-call turn as standalone `function_call` items and a tool result as a
 * `function_call_output` item (not a nested `tool_calls` array / `tool` message), so one message can
 * expand into several input items — hence the array return. The diagnosis loop uses this; the chat
 * client keeps `toOpenAIMessage` (it still streams via Chat Completions).
 */
export function toResponsesInput(message: ChatMessage): OpenAI.Responses.ResponseInputItem[] {
  switch (message.role) {
    case 'system':
      return [{ role: 'system', content: message.content }];
    case 'user':
      return [{ role: 'user', content: message.content }];
    case 'assistant': {
      // A few-shot assistant turn is either a tool-call turn (toolCalls set, content null) or the
      // final diagnosis text. Tool calls become `function_call` items; any accompanying text rides as
      // a separate assistant message so the model sees it in order.
      if (message.toolCalls && message.toolCalls.length > 0) {
        const items: OpenAI.Responses.ResponseInputItem[] = message.toolCalls.map((call) => ({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        }));
        // Currently unreachable: every real caller (the few-shots, and the model's own tool-call
        // turns echoed back in the loop) pairs `toolCalls` with `content: null`. Kept as defensive
        // handling for the day a tool-call turn also carries prose — not exercised by tests today.
        if (message.content != null && message.content !== '') {
          items.unshift({ role: 'assistant', content: message.content });
        }
        return items;
      }
      return [{ role: 'assistant', content: message.content ?? '' }];
    }
    case 'tool':
      return [
        { type: 'function_call_output', call_id: message.toolCallId, output: message.content },
      ];
  }
}

// These two read only ParsedT-independent parts of the response (function_call items, refusal
// parts), so they take `ParsedResponse<unknown>` — `responses.parse`'s ParsedT inference is brittle
// under the conditional tool/reasoning params, and we re-validate `output_parsed` through
// DiagnosisSchema regardless, so narrowing it to `Diagnosis` here buys nothing.

/** The function calls in a response's output, narrowed to the `function_call` items we execute. */
function responseFunctionCalls(
  response: OpenAI.Responses.ParsedResponse<unknown>,
): OpenAI.Responses.ParsedResponseFunctionToolCall[] {
  return response.output.filter(
    (item): item is OpenAI.Responses.ParsedResponseFunctionToolCall =>
      item.type === 'function_call',
  );
}

/** Throw if the model refused — a refusal is a hard failure, not a diagnosis we can persist. A
 * Responses-API refusal surfaces as a `refusal` content part on an output message. */
function assertNoRefusal(response: OpenAI.Responses.ParsedResponse<unknown>): void {
  for (const item of response.output) {
    if (item.type !== 'message') {
      continue;
    }
    for (const part of item.content) {
      if (part.type === 'refusal' && part.refusal !== '') {
        throw new Error(`OpenAI refused to produce a diagnosis: ${part.refusal}`);
      }
    }
  }
}

/**
 * The production `DiagnosisClient`: runs a bounded tool-calling loop against OpenAI Structured
 * Outputs with the shared `DiagnosisSchema` as the response format. Each turn the model may call the
 * retrieval tools (executed via the injected toolkit, results fed back) or emit the final diagnosis;
 * token usage is accumulated across every call. `opts` exists for the key-gated live test (inject a
 * real client / override the model) and the offline loop test (inject a scripted fake OpenAI);
 * production passes nothing and gets the lazy singleton + `env.OPENAI_MODEL`.
 */
export function createOpenAIDiagnosisClient(opts?: {
  client?: OpenAI;
  model?: string;
}): DiagnosisClient {
  // Offline/e2e mode: return a deterministic fake so the stack runs with no key and no network. An
  // explicitly injected client (the key-gated live test) still wins, so the flag can never silently
  // fake a real-call test.
  if (opts?.client == null && env.FAKE_LLM) {
    return createFakeDiagnosisClient();
  }

  const model = opts?.model ?? env.OPENAI_MODEL;

  return {
    async runDiagnosis(
      messages: ChatMessage[],
      toolkit?: DiagnosisToolkit,
    ): Promise<DiagnosisResult> {
      const client = opts?.client ?? getOpenAI();
      const toolCalls: PersistedToolCall[] = [];
      const useTools = toolkit != null && toolkit.definitions.length > 0;

      let promptTokens = 0;
      let completionTokens = 0;
      const accumulate = (usage: OpenAI.Responses.ResponseUsage | undefined): void => {
        promptTokens += usage?.input_tokens ?? 0;
        completionTokens += usage?.output_tokens ?? 0;
      };
      const finish = (diagnosis: Diagnosis): DiagnosisResult => ({
        diagnosis,
        usage: { promptTokens, completionTokens },
        model,
        toolCalls,
      });

      // Reasoning can run on every call now: the Responses API supports function tools AND reasoning
      // together, which is the whole reason for migrating off /v1/chat/completions (there, advertising
      // tools forced reasoning_effort 'none'). Effort is configurable via OPENAI_REASONING_EFFORT, and
      // 'none' OMITS the reasoning param entirely — both to disable reasoning and because a
      // non-reasoning OPENAI_MODEL rejects the field outright. Spread into each request.
      const reasoningParam =
        env.OPENAI_REASONING_EFFORT === 'none'
          ? {}
          : { reasoning: { effort: env.OPENAI_REASONING_EFFORT } };

      // Context is threaded server-side via `previous_response_id` (store: true): the first call sends
      // the full mapped transcript, and each later call sends ONLY the new items (the tool results)
      // plus the prior response id. OpenAI retains the reasoning + function_call items for us, so we
      // never hand-replay them — which both preserves the model's chain-of-thought across tool turns
      // and avoids the fragile/rejected replay of orphaned reasoning items a stateless loop would hit.
      // (The conversation is retained ~30 days; the logs are already redacted to "[REDACTED]" before
      // any tool returns them, so nothing unredacted is stored.)
      let nextInput: OpenAI.Responses.ResponseInputItem[] = messages.flatMap(toResponsesInput);
      let previousResponseId: string | undefined;

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const response = await client.responses.parse({
          model,
          input: nextInput,
          store: true,
          ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
          text: { format: DIAGNOSIS_TEXT_FORMAT },
          ...reasoningParam,
          ...(useTools ? { tools: toolkit.definitions, tool_choice: 'auto' } : {}),
        });
        accumulate(response.usage);
        assertNoRefusal(response);
        previousResponseId = response.id;

        const requestedCalls = useTools ? responseFunctionCalls(response) : [];
        if (toolkit && requestedCalls.length > 0) {
          // Execute each call and carry ONLY the tool results into the next turn as function_call_output
          // items (paired to their call by call_id). The matching function_call + any reasoning items
          // live server-side under previousResponseId, so we must not re-send them here.
          const outputs: OpenAI.Responses.ResponseInputItem[] = [];
          for (const call of requestedCalls) {
            const result = await toolkit.execute(call.name, call.arguments);
            outputs.push({ type: 'function_call_output', call_id: call.call_id, output: result });
            toolCalls.push({
              id: call.call_id,
              name: call.name,
              arguments: call.arguments,
              result,
            });
          }
          nextInput = outputs;
          continue;
        }

        if (response.output_parsed != null) {
          // Enforce the full contract here: the schema we send omits the numeric `confidence` bound
          // (see stripNumericRangeKeywords), so this parse is what guarantees confidence ∈ [0,1] and
          // the complete DiagnosisSchema shape on the value we persist.
          return finish(DiagnosisSchema.parse(response.output_parsed));
        }

        // No tool calls and no parsed diagnosis — nothing more will come from looping; force a final
        // answer below (no new input; the model answers from the server-side context) rather than spin.
        nextInput = [];
        break;
      }

      // Loop exhausted (or a degenerate empty turn): make one final tool-disabled call so an
      // investigation always ends in a diagnosis instead of an error. It sends any pending tool
      // results plus previousResponseId, so the model answers from the full retained context.
      const finalResponse = await client.responses.parse({
        model,
        input: nextInput,
        store: true,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        text: { format: DIAGNOSIS_TEXT_FORMAT },
        ...reasoningParam,
        // Tools are still advertised (even with tool_choice 'none') so the schema/context are identical.
        ...(useTools ? { tools: toolkit.definitions, tool_choice: 'none' } : {}),
      });
      accumulate(finalResponse.usage);

      assertNoRefusal(finalResponse);
      if (finalResponse.output_parsed == null) {
        throw new Error('OpenAI returned no parsed diagnosis after the tool-calling loop.');
      }
      return finish(DiagnosisSchema.parse(finalResponse.output_parsed));
    },
  };
}
