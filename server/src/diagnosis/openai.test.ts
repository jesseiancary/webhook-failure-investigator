import type OpenAI from 'openai';
import { afterEach, describe, expect, it } from 'vitest';
import type { Diagnosis } from './diagnosis.schema.js';
import { createOpenAIDiagnosisClient, type DiagnosisToolkit } from './openai.js';
import type { ChatMessage } from './prompt.js';

// Offline unit test of the bounded tool-calling loop. A scripted fake `OpenAI` returns a tool call
// then a final parsed diagnosis, so the real loop runs deterministically with no key and no network:
// we assert the tool executed with the scoped eventId, its result was fed back into the next model
// call, token usage summed across both calls, the trace came back for persistence, and the final
// diagnosis's citation resolves against what the tool returned.

// Minimal shapes of the `responses.parse` request/response the loop actually touches. Kept local
// (and loose) so the fake stays small; the real SDK types are far wider than the loop reads. On the
// Responses API a tool call is a top-level `function_call` output item, context is threaded with
// `previous_response_id` (so each later call sends ONLY the new `function_call_output` input items,
// not a replayed transcript), the structured answer is `output_parsed`, and usage is
// `input_tokens`/`output_tokens`.
interface ScriptedFunctionCall {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}
/** A reasoning item a reasoning model emits before its tool calls; the loop must NOT replay it. */
interface ScriptedReasoning {
  type: 'reasoning';
  id: string;
  summary: [];
}
type ScriptedOutputItem = ScriptedFunctionCall | ScriptedReasoning;
interface ScriptedResponse {
  id: string;
  usage: { input_tokens: number; output_tokens: number };
  output: ScriptedOutputItem[];
  output_parsed: Diagnosis | null;
}
interface ResponsesBody {
  input: Array<{ type?: string; role?: string; output?: string; call_id?: string }>;
  previous_response_id?: string;
  store?: boolean;
  reasoning?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
}

const groundedDiagnosis: Diagnosis = {
  failureCategory: 'authentication',
  rootCause: 'Rejected with HTTP 401 — an expired credential.',
  confidence: 0.95,
  evidence: [
    { field: 'attempts[0].responseStatus', value: '401', note: 'Rejected on authentication.' },
  ],
  remediationSteps: ['Rotate the API key.'],
  reachabilityAssessment: 'reachable',
  isSpeculative: false,
};

const TOOL_RESULT = 'DELIVERY HISTORY — 1 attempt(s)\nattempts[0].responseStatus: 401';

/** Build a scripted fake OpenAI that returns the given responses in order, recording each request. */
function makeFakeOpenAI(script: ScriptedResponse[]): { client: OpenAI; bodies: ResponsesBody[] } {
  const bodies: ResponsesBody[] = [];
  const queue = [...script];
  const parse = async (body: ResponsesBody): Promise<ScriptedResponse> => {
    bodies.push(body);
    const next = queue.shift();
    if (next === undefined) throw new Error('fake OpenAI: no scripted response left');
    return next;
  };
  const client = { responses: { parse } } as unknown as OpenAI;
  return { client, bodies };
}

/** A toolkit whose executor records its calls and returns a fixed citable block (no DB). */
function makeSpyToolkit(): DiagnosisToolkit & { calls: Array<{ name: string; args: string }> } {
  const calls: Array<{ name: string; args: string }> = [];
  return {
    calls,
    definitions: [
      {
        type: 'function',
        name: 'get_delivery_history',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        strict: true,
      },
    ],
    async execute(name: string, args: string): Promise<string> {
      calls.push({ name, args });
      return TOOL_RESULT;
    },
  };
}

const messages: ChatMessage[] = [
  { role: 'system', content: 'system prompt' },
  { role: 'user', content: 'WEBHOOK DELIVERY UNDER INVESTIGATION\neventId: evt_x' },
];

/** One tool-call turn (the model asks for `get_delivery_history`), with distinct ids. */
function toolTurn(callId: string, responseId: string): ScriptedResponse {
  return {
    id: responseId,
    usage: { input_tokens: 100, output_tokens: 20 },
    output: [
      {
        type: 'function_call',
        call_id: callId,
        name: 'get_delivery_history',
        arguments: JSON.stringify({ eventId: 'evt_x' }),
      },
    ],
    output_parsed: null,
  };
}

/** The final turn that returns the parsed diagnosis (no tool calls). */
function diagnosisTurn(responseId: string): ScriptedResponse {
  return {
    id: responseId,
    usage: { input_tokens: 150, output_tokens: 40 },
    output: [],
    output_parsed: groundedDiagnosis,
  };
}

function scriptedToolThenDiagnosis(): ScriptedResponse[] {
  return [toolTurn('call_1', 'resp_1'), diagnosisTurn('resp_2')];
}

afterEach(() => {
  delete process.env.OPENAI_REASONING_EFFORT;
});

describe('createOpenAIDiagnosisClient tool-calling loop', () => {
  it('executes the requested tool with the scoped eventId and feeds the result back', async () => {
    const { client, bodies } = makeFakeOpenAI(scriptedToolThenDiagnosis());
    const toolkit = makeSpyToolkit();

    await createOpenAIDiagnosisClient({ client, model: 'gpt-6-luna' }).runDiagnosis(
      messages,
      toolkit,
    );

    // The tool ran once, named by the model, with the eventId the model passed.
    expect(toolkit.calls).toHaveLength(1);
    expect(toolkit.calls[0]?.name).toBe('get_delivery_history');
    expect(JSON.parse(toolkit.calls[0]!.args)).toEqual({ eventId: 'evt_x' });

    // The second model call threads the prior response and feeds the tool result back as a
    // `function_call_output` input item.
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.previous_response_id).toBe('resp_1');
    const fedBack = bodies[1]?.input.find((m) => m.type === 'function_call_output');
    expect(fedBack?.output).toBe(TOOL_RESULT);
    expect(fedBack?.call_id).toBe('call_1');
  });

  it('threads context via previous_response_id and sends only new tool outputs (no replay)', async () => {
    // The loop must NOT hand-replay prior-turn reasoning/function_call items (fragile on the real
    // API); it threads them server-side via previous_response_id + store, sending only the new output.
    const script = scriptedToolThenDiagnosis();
    script[0]!.output.unshift({ type: 'reasoning', id: 'rs_1', summary: [] });
    const { client, bodies } = makeFakeOpenAI(script);
    const toolkit = makeSpyToolkit();

    await createOpenAIDiagnosisClient({ client, model: 'gpt-6-luna' }).runDiagnosis(
      messages,
      toolkit,
    );

    // First call: full transcript, no prior-response pointer, store on.
    expect(bodies[0]?.previous_response_id).toBeUndefined();
    expect(bodies[0]!.input.length).toBeGreaterThan(1);
    expect(bodies[0]?.store).toBe(true);

    // Second call: threads the prior response and sends ONLY the new function_call_output — no
    // re-sent transcript, no hand-replayed reasoning/function_call items.
    expect(bodies[1]?.previous_response_id).toBe('resp_1');
    expect(bodies[1]?.input.every((m) => m.type === 'function_call_output')).toBe(true);
    expect(bodies[1]?.input.some((m) => m.type === 'reasoning' || m.type === 'function_call')).toBe(
      false,
    );
  });

  it('omits the reasoning param only when OPENAI_REASONING_EFFORT is none', async () => {
    // Default (medium): reasoning is sent.
    const withDefault = makeFakeOpenAI(scriptedToolThenDiagnosis());
    await createOpenAIDiagnosisClient({
      client: withDefault.client,
      model: 'gpt-6-luna',
    }).runDiagnosis(messages, makeSpyToolkit());
    expect(withDefault.bodies[0]?.reasoning).toBeDefined();

    // 'none' omits the field entirely (required for a non-reasoning model, which rejects it).
    process.env.OPENAI_REASONING_EFFORT = 'none';
    const none = makeFakeOpenAI(scriptedToolThenDiagnosis());
    await createOpenAIDiagnosisClient({ client: none.client, model: 'gpt-6-luna' }).runDiagnosis(
      messages,
      makeSpyToolkit(),
    );
    expect(none.bodies[0]?.reasoning).toBeUndefined();
  });

  it('sums token usage across every call and returns the diagnosis + trace', async () => {
    const { client } = makeFakeOpenAI(scriptedToolThenDiagnosis());
    const toolkit = makeSpyToolkit();

    const result = await createOpenAIDiagnosisClient({
      client,
      model: 'gpt-6-luna',
    }).runDiagnosis(messages, toolkit);

    // Usage accumulates across the tool turn and the final answer (input 100+150, output 20+40).
    expect(result.usage.promptTokens).toBe(250);
    expect(result.usage.completionTokens).toBe(60);

    expect(result.diagnosis.failureCategory).toBe('authentication');

    // The trace flows back for persistence.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      id: 'call_1',
      name: 'get_delivery_history',
      result: TOOL_RESULT,
    });
  });

  it('grounds the diagnosis: every cited field resolves against a returned tool result', async () => {
    const { client } = makeFakeOpenAI(scriptedToolThenDiagnosis());
    const toolkit = makeSpyToolkit();

    const result = await createOpenAIDiagnosisClient({
      client,
      model: 'gpt-6-luna',
    }).runDiagnosis(messages, toolkit);

    const toolText = result.toolCalls.map((c) => c.result).join('\n');
    for (const item of result.diagnosis.evidence) {
      // The labeled line the citation refers to appears verbatim in what a tool returned.
      expect(toolText).toContain(`${item.field}: ${item.value}`);
    }
  });

  it('feeds a tool error-result back and keeps going (graceful, not a thrown abort)', async () => {
    // When a call is rejected (bad/empty/out-of-scope args), the toolkit returns an explanatory
    // string rather than throwing; the loop must feed it back as a `function_call_output` item and
    // let the model recover — ending in a diagnosis, not a 500.
    const errorResult =
      'Invalid arguments for "get_delivery_history": eventId: String must contain at least 1 character(s).';
    const { client, bodies } = makeFakeOpenAI(scriptedToolThenDiagnosis());
    const toolkit: DiagnosisToolkit = {
      definitions: makeSpyToolkit().definitions,
      async execute(): Promise<string> {
        return errorResult;
      },
    };

    const result = await createOpenAIDiagnosisClient({
      client,
      model: 'gpt-6-luna',
    }).runDiagnosis(messages, toolkit);

    // The error-result was fed back to the model as a function_call_output item...
    const fedBack = bodies[1]?.input.find((m) => m.type === 'function_call_output');
    expect(fedBack?.output).toBe(errorResult);
    // ...and the loop still produced a diagnosis.
    expect(result.diagnosis.failureCategory).toBe('authentication');
    expect(result.toolCalls[0]?.result).toBe(errorResult);
  });

  it('forces a final tool-disabled answer when the loop never stops calling tools', async () => {
    // The model keeps calling tools through all MAX_TOOL_ITERATIONS (6) auto turns; the loop must
    // then make one forced, tool-disabled call that returns the diagnosis rather than looping forever.
    // Each scripted turn carries a DISTINCT call_id/response id (what the real API requires).
    const script: ScriptedResponse[] = [
      ...Array.from({ length: 6 }, (_, i) => toolTurn(`call_${i + 1}`, `resp_${i + 1}`)),
      diagnosisTurn('resp_final'),
    ];
    const { client, bodies } = makeFakeOpenAI(script);
    const toolkit = makeSpyToolkit();

    const result = await createOpenAIDiagnosisClient({
      client,
      model: 'gpt-6-luna',
    }).runDiagnosis(messages, toolkit);

    expect(result.diagnosis.failureCategory).toBe('authentication');
    // 6 auto iterations + 1 forced final call = 7 model calls; the forced call disables tools.
    expect(bodies).toHaveLength(7);
    expect(bodies[6]?.tool_choice).toBe('none');
    // Each tool turn recorded a distinct call id (no duplicate call_ids the real API would reject).
    expect(new Set(result.toolCalls.map((c) => c.id)).size).toBe(6);
  });
});
