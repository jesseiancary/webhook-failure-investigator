import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import type { Diagnosis } from './diagnosis.schema.js';
import { createOpenAIDiagnosisClient, type DiagnosisToolkit } from './openai.js';
import type { ChatMessage } from './prompt.js';

// Offline unit test of the bounded tool-calling loop. A scripted fake `OpenAI` returns a tool call
// then a final parsed diagnosis, so the real loop runs deterministically with no key and no network:
// we assert the tool executed with the scoped eventId, its result was fed back into the next model
// call, token usage summed across both calls, the trace came back for persistence, and the final
// diagnosis's citation resolves against what the tool returned.

// Minimal shapes of the `chat.completions.parse` request/response the loop actually touches. Kept
// local (and loose) so the fake stays small; the real SDK types are far wider than the loop reads.
interface ScriptedToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
interface ScriptedCompletion {
  usage: { prompt_tokens: number; completion_tokens: number };
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ScriptedToolCall[];
      parsed: Diagnosis | null;
      refusal: string | null;
    };
  }>;
}
interface ParseBody {
  messages: Array<{ role: string; content: string | null; tool_call_id?: string }>;
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

/** Build a scripted fake OpenAI that returns the given completions in order, recording each request. */
function makeFakeOpenAI(script: ScriptedCompletion[]): { client: OpenAI; bodies: ParseBody[] } {
  const bodies: ParseBody[] = [];
  const queue = [...script];
  const parse = async (body: ParseBody): Promise<ScriptedCompletion> => {
    bodies.push(body);
    const next = queue.shift();
    if (next === undefined) throw new Error('fake OpenAI: no scripted response left');
    return next;
  };
  const client = { chat: { completions: { parse } } } as unknown as OpenAI;
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
        function: {
          name: 'get_delivery_history',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
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

function scriptedToolThenDiagnosis(): ScriptedCompletion[] {
  return [
    {
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_delivery_history',
                  arguments: JSON.stringify({ eventId: 'evt_x' }),
                },
              },
            ],
            parsed: null,
            refusal: null,
          },
        },
      ],
    },
    {
      usage: { prompt_tokens: 150, completion_tokens: 40 },
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify(groundedDiagnosis),
            parsed: groundedDiagnosis,
            refusal: null,
          },
        },
      ],
    },
  ];
}

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

    // The second model call saw the tool result fed back as a `tool` message.
    expect(bodies).toHaveLength(2);
    const fedBack = bodies[1]?.messages.find((m) => m.role === 'tool');
    expect(fedBack?.content).toBe(TOOL_RESULT);
  });

  it('sums token usage across every call and returns the diagnosis + trace', async () => {
    const { client } = makeFakeOpenAI(scriptedToolThenDiagnosis());
    const toolkit = makeSpyToolkit();

    const result = await createOpenAIDiagnosisClient({
      client,
      model: 'gpt-6-luna',
    }).runDiagnosis(messages, toolkit);

    // Usage accumulates across the tool turn and the final answer (100+150, 20+40).
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
    // string rather than throwing; the loop must feed it back as a `tool` message and let the model
    // recover — ending in a diagnosis, not a 500.
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

    // The error-result was fed back to the model as a tool message...
    const fedBack = bodies[1]?.messages.find((m) => m.role === 'tool');
    expect(fedBack?.content).toBe(errorResult);
    // ...and the loop still produced a diagnosis.
    expect(result.diagnosis.failureCategory).toBe('authentication');
    expect(result.toolCalls[0]?.result).toBe(errorResult);
  });

  it('forces a final tool-disabled answer when the loop never stops calling tools', async () => {
    // The model keeps calling tools through all MAX_TOOL_ITERATIONS (6) auto turns; the loop must
    // then make one forced, tool-disabled call that returns the diagnosis rather than looping forever.
    const toolTurn = scriptedToolThenDiagnosis()[0]!;
    const finalTurn = scriptedToolThenDiagnosis()[1]!;
    const script = [...Array(6).fill(toolTurn), finalTurn] as ScriptedCompletion[];
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
  });
});
