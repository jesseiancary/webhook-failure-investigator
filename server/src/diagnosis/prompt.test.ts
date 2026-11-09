import { describe, expect, it } from 'vitest';
import { DiagnosisSchema } from './diagnosis.schema.js';
import {
  FEW_SHOT_MESSAGES,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserMessage,
  type InvestigationRequest,
} from './prompt.js';

const request: InvestigationRequest = {
  eventId: 'evt_abc123',
  source: 'stripe',
  eventType: 'invoice.payment_failed',
  attemptCount: 2,
};

describe('buildUserMessage', () => {
  it('names the event under investigation', () => {
    const message = buildUserMessage(request);
    expect(message).toContain('eventId: evt_abc123');
    expect(message).toContain('source: stripe');
    expect(message).toContain('eventType: invoice.payment_failed');
    expect(message).toContain('attempts recorded: 2');
  });

  it('instructs the model to retrieve logs through the tools before diagnosing (diagnosis-v2)', () => {
    const message = buildUserMessage(request);
    expect(message).toContain('get_event_payload');
    expect(message).toContain('get_delivery_history');
  });

  it('carries no log data — retrieval is the model’s job now', () => {
    // The request is a reference, not a dump: no serialized attempt field paths ride in it.
    expect(buildUserMessage(request)).not.toContain('attempts[0].responseStatus');
  });

  it('is deterministic for the same input', () => {
    expect(buildUserMessage(request)).toEqual(buildUserMessage(request));
  });
});

describe('prompt metadata', () => {
  it('pins a stable prompt version', () => {
    expect(PROMPT_VERSION).toBe('diagnosis-v2');
  });

  it('encodes the grounding rule, taxonomy edges, and retrieval contract in the system prompt', () => {
    expect(SYSTEM_PROMPT).toContain('insufficient_evidence');
    expect(SYSTEM_PROMPT).toContain('GROUNDING RULE');
    expect(SYSTEM_PROMPT).toContain('RETRIEVAL');
    expect(SYSTEM_PROMPT).toContain('get_event_payload');
    expect(SYSTEM_PROMPT).toContain('get_delivery_history');
  });
});

describe('FEW_SHOT_MESSAGES', () => {
  it('opens each trajectory with the investigation request', () => {
    expect(FEW_SHOT_MESSAGES[0]?.role).toBe('user');
  });

  it('demonstrates the retrieval tools before answering', () => {
    const toolNames = FEW_SHOT_MESSAGES.filter((m) => m.role === 'assistant').flatMap((m) =>
      m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => c.name) : [],
    );
    expect(toolNames).toContain('get_event_payload');
    expect(toolNames).toContain('get_delivery_history');
  });

  it('pairs every tool result to a tool call the assistant actually made', () => {
    const callIds = new Set(
      FEW_SHOT_MESSAGES.flatMap((m) =>
        m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => c.id) : [],
      ),
    );
    const toolTurns = FEW_SHOT_MESSAGES.filter((m) => m.role === 'tool');
    expect(toolTurns.length).toBeGreaterThan(0);
    for (const turn of toolTurns) {
      // Narrow to the tool variant for toolCallId.
      if (turn.role === 'tool') expect(callIds.has(turn.toolCallId)).toBe(true);
    }
  });

  it('every natural-language assistant turn is a diagnosis valid against DiagnosisSchema', () => {
    // The final assistant turn of each trajectory carries the diagnosis as JSON string content;
    // the tool-call turns carry null content, so filtering on string content isolates the answers.
    const answers = FEW_SHOT_MESSAGES.filter(
      (m) => m.role === 'assistant' && typeof m.content === 'string',
    );
    expect(answers.length).toBeGreaterThan(0);
    for (const turn of answers) {
      if (turn.role === 'assistant' && typeof turn.content === 'string') {
        expect(DiagnosisSchema.safeParse(JSON.parse(turn.content)).success).toBe(true);
      }
    }
  });
});
