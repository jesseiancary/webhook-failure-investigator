import { describe, expect, it } from 'vitest';
import { DiagnosisSchema } from './diagnosis.schema.js';
import {
  FEW_SHOT_MESSAGES,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserMessage,
  type SerializableEvent,
} from './prompt.js';

const event: SerializableEvent = {
  source: 'stripe',
  eventType: 'invoice.payment_failed',
  payload: { id: 'evt_1Pf2A', type: 'invoice.payment_failed' },
  headers: { authorization: '[REDACTED]', 'content-type': 'application/json' },
  attempts: [
    {
      attemptedAt: new Date('2026-11-08T02:00:00.000Z'),
      requestUrl: 'https://hooks.example-app.com/webhooks/stripe',
      requestMethod: 'POST',
      requestHeaders: { authorization: '[REDACTED]' },
      requestBody: { id: 'evt_1Pf2A' },
      responseStatus: 401,
      responseHeaders: { 'www-authenticate': 'Bearer realm="api"' },
      responseBody: { error: { code: 'api_key_expired' } },
      latencyMs: 118,
    },
  ],
};

describe('buildUserMessage', () => {
  it('labels fields with the exact citable paths', () => {
    const message = buildUserMessage(event);
    expect(message).toContain('attempts[0].responseStatus: 401');
    expect(message).toContain('attempts[0].responseHeaders:');
    expect(message).toContain('attempts[0].responseBody:');
    expect(message).toContain('source: stripe');
  });

  it('renders a Date attemptedAt as an ISO-8601 string', () => {
    expect(buildUserMessage(event)).toContain('attempts[0].attemptedAt: 2026-11-08T02:00:00.000Z');
  });

  it('keeps redacted values redacted and never leaks a raw secret', () => {
    const message = buildUserMessage(event);
    expect(message).toContain('[REDACTED]');
    // The serializer must not un-redact — it only ever sees already-redacted data.
    expect(message).not.toContain('Bearer sk-');
  });

  it('renders absent response fields explicitly (the insufficient-evidence signal)', () => {
    const dropped: SerializableEvent = {
      ...event,
      attempts: [
        {
          requestUrl: 'https://hooks.example-app.com/webhooks/stripe',
          requestMethod: 'POST',
          requestHeaders: {},
          errorText: 'socket hang up',
        },
      ],
    };
    const message = buildUserMessage(dropped);
    expect(message).toContain('attempts[0].responseStatus: (absent)');
    expect(message).toContain('attempts[0].attemptedAt: (absent)');
    expect(message).toContain('attempts[0].errorText: socket hang up');
  });

  it('is deterministic for the same input', () => {
    expect(buildUserMessage(event)).toEqual(buildUserMessage(event));
  });
});

describe('prompt metadata', () => {
  it('pins a stable prompt version', () => {
    expect(PROMPT_VERSION).toBe('diagnosis-v1');
  });

  it('encodes the grounding rule and taxonomy edges in the system prompt', () => {
    expect(SYSTEM_PROMPT).toContain('insufficient_evidence');
    expect(SYSTEM_PROMPT).toContain('GROUNDING RULE');
  });
});

describe('FEW_SHOT_MESSAGES', () => {
  it('alternates user → assistant turns', () => {
    expect(FEW_SHOT_MESSAGES.length).toBeGreaterThan(0);
    FEW_SHOT_MESSAGES.forEach((message, i) => {
      expect(message.role).toBe(i % 2 === 0 ? 'user' : 'assistant');
    });
  });

  it('every assistant turn is a diagnosis valid against DiagnosisSchema', () => {
    const assistantTurns = FEW_SHOT_MESSAGES.filter((m) => m.role === 'assistant');
    expect(assistantTurns.length).toBeGreaterThan(0);
    for (const turn of assistantTurns) {
      expect(DiagnosisSchema.safeParse(JSON.parse(turn.content)).success).toBe(true);
    }
  });
});
