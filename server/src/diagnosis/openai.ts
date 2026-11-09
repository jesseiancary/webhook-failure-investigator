import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { env } from '../config/env.js';
import { DiagnosisSchema, type Diagnosis } from './diagnosis.schema.js';
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
  definitions: OpenAI.Chat.Completions.ChatCompletionTool[];
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
function getOpenAI(): OpenAI {
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

// Build the response format once (the schema is static) and sanitize it in place — mutating the
// nested `schema` preserves the object's auto-parse brand, so `.parse()` still deserializes the
// completion through DiagnosisSchema (which is where the [0,1] bound is enforced).
const DIAGNOSIS_RESPONSE_FORMAT = (() => {
  const responseFormat = zodResponseFormat(DiagnosisSchema, 'diagnosis');
  stripNumericRangeKeywords(responseFormat.json_schema.schema);
  return responseFormat;
})();

function toOpenAIMessage(message: ChatMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
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

/** The function tool calls on a completion message, narrowed to the `function` variant we support. */
function functionToolCalls(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined,
): OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] {
  return (message?.tool_calls ?? []).filter(
    (call): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
      call.type === 'function',
  );
}

/** Throw if the model refused — a refusal is a hard failure, not a diagnosis we can persist. */
function assertNoRefusal(message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined): void {
  if (message?.refusal != null && message.refusal !== '') {
    throw new Error(`OpenAI refused to produce a diagnosis: ${message.refusal}`);
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
  const model = opts?.model ?? env.OPENAI_MODEL;

  return {
    async runDiagnosis(
      messages: ChatMessage[],
      toolkit?: DiagnosisToolkit,
    ): Promise<DiagnosisResult> {
      const client = opts?.client ?? getOpenAI();
      const working: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        messages.map(toOpenAIMessage);
      const toolCalls: PersistedToolCall[] = [];
      const useTools = toolkit != null && toolkit.definitions.length > 0;

      let promptTokens = 0;
      let completionTokens = 0;
      const accumulate = (usage: OpenAI.Completions.CompletionUsage | undefined): void => {
        promptTokens += usage?.prompt_tokens ?? 0;
        completionTokens += usage?.completion_tokens ?? 0;
      };
      const finish = (diagnosis: Diagnosis): DiagnosisResult => ({
        diagnosis,
        usage: { promptTokens, completionTokens },
        model,
        toolCalls,
      });

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
        const completion = await client.chat.completions.parse({
          model,
          messages: working,
          response_format: DIAGNOSIS_RESPONSE_FORMAT,
          // Advertising function tools to a reasoning model on /v1/chat/completions requires
          // reasoning_effort 'none' (the API rejects the default and points to /v1/responses). This
          // disables reasoning on the tool path, including the final diagnosis; it's an accepted v1
          // tradeoff — the live tests confirm the model still grounds correctly, and migrating the
          // client to the Responses API (which supports tools + reasoning together) is a deferred
          // follow-up (see docs/PHASE_5_PLAN.md "Out of scope" and ROADMAP Phase 5). Scope it to the
          // tool path so the no-tool branch keeps the model's default reasoning behavior.
          ...(useTools
            ? { tools: toolkit.definitions, tool_choice: 'auto', reasoning_effort: 'none' }
            : {}),
        });
        accumulate(completion.usage);

        const message = completion.choices[0]?.message;
        assertNoRefusal(message);

        const requestedCalls = useTools ? functionToolCalls(message) : [];
        if (toolkit && requestedCalls.length > 0) {
          // Record the assistant turn verbatim, then execute each call and feed the result back so
          // the next turn sees the retrieved logs.
          working.push({
            role: 'assistant',
            content: message?.content ?? null,
            tool_calls: requestedCalls.map((call) => ({
              id: call.id,
              type: 'function',
              function: { name: call.function.name, arguments: call.function.arguments },
            })),
          });
          for (const call of requestedCalls) {
            const result = await toolkit.execute(call.function.name, call.function.arguments);
            working.push({ role: 'tool', tool_call_id: call.id, content: result });
            toolCalls.push({
              id: call.id,
              name: call.function.name,
              arguments: call.function.arguments,
              result,
            });
          }
          continue;
        }

        if (message?.parsed != null) {
          // Enforce the full contract here: the schema we send omits the numeric `confidence` bound
          // (see stripNumericRangeKeywords), so this parse is what guarantees confidence ∈ [0,1] and
          // the complete DiagnosisSchema shape on the value we persist.
          return finish(DiagnosisSchema.parse(message.parsed));
        }

        // No tool calls and no parsed diagnosis — nothing more will come from looping; force a final
        // answer below rather than spin.
        break;
      }

      // Loop exhausted (or a degenerate empty turn): make one final tool-disabled call so an
      // investigation always ends in a diagnosis instead of an error.
      const finalCompletion = await client.chat.completions.parse({
        model,
        messages: working,
        response_format: DIAGNOSIS_RESPONSE_FORMAT,
        // Tools are still advertised (even with tool_choice 'none'), so keep reasoning_effort 'none'.
        ...(useTools
          ? { tools: toolkit.definitions, tool_choice: 'none', reasoning_effort: 'none' }
          : {}),
      });
      accumulate(finalCompletion.usage);

      const finalMessage = finalCompletion.choices[0]?.message;
      assertNoRefusal(finalMessage);
      if (finalMessage?.parsed == null) {
        throw new Error('OpenAI returned no parsed diagnosis after the tool-calling loop.');
      }
      return finish(DiagnosisSchema.parse(finalMessage.parsed));
    },
  };
}
