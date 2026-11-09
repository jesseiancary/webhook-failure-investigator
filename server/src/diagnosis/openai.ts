import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { env } from '../config/env.js';
import { DiagnosisSchema, type Diagnosis } from './diagnosis.schema.js';
import type { ChatMessage } from './prompt.js';

// The OpenAI seam for diagnosis. `DiagnosisClient` is the narrow contract the service depends on —
// "given the assembled chat messages, return a validated diagnosis + token usage" — so tests inject
// a deterministic stub and never touch the network. The real implementation
// (`createOpenAIDiagnosisClient`) is the only code that talks to OpenAI.

export interface DiagnosisUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface DiagnosisResult {
  diagnosis: Diagnosis;
  usage: DiagnosisUsage;
  /** The model that produced the diagnosis, recorded on the Investigation for cost/traceability. */
  model: string;
}

/** The subset of behavior the service needs; implemented for real by OpenAI and by a test stub. */
export interface DiagnosisClient {
  runDiagnosis(messages: ChatMessage[]): Promise<DiagnosisResult>;
}

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
    case 'assistant':
      return { role: 'assistant', content: message.content };
  }
}

/**
 * The production `DiagnosisClient`: calls OpenAI Structured Outputs with the shared `DiagnosisSchema`
 * as the response format, re-validates the parsed object, and returns it with token usage. `opts`
 * exists for the key-gated live test (inject a real client / override the model); production passes
 * nothing and gets the lazy singleton + `env.OPENAI_MODEL`.
 */
export function createOpenAIDiagnosisClient(opts?: {
  client?: OpenAI;
  model?: string;
}): DiagnosisClient {
  const model = opts?.model ?? env.OPENAI_MODEL;

  return {
    async runDiagnosis(messages: ChatMessage[]): Promise<DiagnosisResult> {
      const client = opts?.client ?? getOpenAI();
      const completion = await client.chat.completions.parse({
        model,
        messages: messages.map(toOpenAIMessage),
        response_format: DIAGNOSIS_RESPONSE_FORMAT,
      });

      const choice = completion.choices[0];
      const message = choice?.message;
      if (message?.refusal != null && message.refusal !== '') {
        throw new Error(`OpenAI refused to produce a diagnosis: ${message.refusal}`);
      }
      if (message?.parsed == null) {
        throw new Error('OpenAI returned no parsed diagnosis content.');
      }

      // Enforce the full contract here: the schema we sent omits the numeric `confidence` bound (see
      // stripNumericRangeKeywords), so this parse is what actually guarantees confidence ∈ [0,1] and
      // the complete DiagnosisSchema shape on the value we persist.
      const diagnosis = DiagnosisSchema.parse(message.parsed);

      return {
        diagnosis,
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
        },
        model,
      };
    },
  };
}
