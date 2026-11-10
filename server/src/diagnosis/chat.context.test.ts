import { describe, expect, it } from 'vitest';
import {
  CHAT_SYSTEM_PROMPT,
  type ChatHistoryRow,
  assembleChatMessages,
  buildDiagnosisSnapshot,
  buildLogContext,
  loadChatHistory,
} from './chat.context.js';
import type { Diagnosis } from './diagnosis.schema.js';
import type { SerializableAttempt, SerializableEvent } from './serialize.js';
import { estimateTokens } from './token-budget.js';

const diagnosis: Diagnosis = {
  failureCategory: 'authentication',
  rootCause: 'Rejected with HTTP 401 and an api_key_expired error code.',
  confidence: 0.96,
  evidence: [
    { field: 'attempts[0].responseStatus', value: '401', note: 'Rejected on authentication.' },
  ],
  remediationSteps: ['Rotate the expired API key.'],
  reachabilityAssessment: 'reachable',
  isSpeculative: false,
};

const attempt: SerializableAttempt = {
  requestUrl: 'https://hooks.example-app.com/webhooks/stripe',
  requestMethod: 'POST',
  requestHeaders: { authorization: '[REDACTED]' },
  requestBody: { id: 'evt_1' },
  responseStatus: 401,
  responseHeaders: { 'www-authenticate': 'Bearer error="invalid_token"' },
  responseBody: { error: { code: 'api_key_expired' } },
  latencyMs: 118,
  attemptedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const event: SerializableEvent = {
  source: 'stripe',
  eventType: 'invoice.payment_failed',
  payload: { id: 'evt_1', type: 'invoice.payment_failed' },
  headers: { 'content-type': 'application/json' },
  attempts: [attempt],
};

describe('buildDiagnosisSnapshot', () => {
  it('renders the category, root cause, evidence, and remediation as a compact block', () => {
    const snapshot = buildDiagnosisSnapshot(diagnosis);
    expect(snapshot).toContain('failureCategory: authentication');
    expect(snapshot).toContain('confidence: 0.96');
    expect(snapshot).toContain('reachabilityAssessment: reachable');
    expect(snapshot).toContain('rootCause: Rejected with HTTP 401');
    expect(snapshot).toContain('- attempts[0].responseStatus = 401 — Rejected on authentication.');
    expect(snapshot).toContain('- Rotate the expired API key.');
  });
});

describe('buildLogContext', () => {
  it('serializes the payload and delivery history with citable field paths', () => {
    const logs = buildLogContext(event);
    expect(logs).toContain('EVENT PAYLOAD');
    expect(logs).toContain('DELIVERY HISTORY — 1 attempt(s)');
    expect(logs).toContain('attempts[0].responseStatus: 401');
    expect(logs).toContain('api_key_expired');
  });

  it('truncates an over-long body with a pointer but never truncates headers', () => {
    const bigEvent: SerializableEvent = {
      ...event,
      attempts: [
        {
          ...attempt,
          responseBody: { blob: 'z'.repeat(5000) },
          // A large header blob — must survive intact so its fields stay citable.
          responseHeaders: {
            'www-authenticate': 'Bearer error="invalid_token"',
            pad: 'h'.repeat(5000),
          },
        },
      ],
    };
    const logs = buildLogContext(bigEvent, 2000);

    // The body is truncated with a pointer.
    expect(logs).toContain('[truncated — showing first 2000 of');
    expect(logs).toContain('full body in the delivery record');
    // Headers are left whole: the full 5000-char pad and the citable challenge both survive
    // (rendered as JSON, so the inner quotes are escaped).
    expect(logs).toContain('h'.repeat(5000));
    expect(logs).toContain('www-authenticate');
    expect(logs).toContain('Bearer error=');
    // Short, citable fields are untouched.
    expect(logs).toContain('attempts[0].responseStatus: 401');
    expect(logs).toContain('attempts[0].requestMethod: POST');
  });
});

describe('loadChatHistory', () => {
  it('keeps only chat turns (user + plain assistant), orders by seq, and drops the diagnosis trace', () => {
    const rows: ChatHistoryRow[] = [
      // Phase-5 diagnosis retrieval trace — must be excluded.
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'get_event_payload', arguments: '{}' }],
        seq: 1,
      },
      { role: 'tool', content: 'EVENT PAYLOAD …', seq: 2 },
      // Chat turns, intentionally out of seq order to prove sorting.
      {
        role: 'assistant',
        content: 'Because the 401 names an expired key.',
        toolCalls: null,
        seq: 4,
      },
      { role: 'user', content: 'Why not a network issue?', seq: 3 },
    ];

    expect(loadChatHistory(rows)).toEqual([
      { role: 'user', content: 'Why not a network issue?' },
      { role: 'assistant', content: 'Because the 401 names an expired key.' },
    ]);
  });
});

describe('assembleChatMessages', () => {
  const history: ChatHistoryRow[] = [
    { role: 'user', content: 'Earlier question?', seq: 1 },
    { role: 'assistant', content: 'Earlier answer.', seq: 2 },
  ];

  it('orders [system, context, ...history, question] and embeds snapshot + logs in the context', () => {
    const messages = assembleChatMessages({
      diagnosis,
      event,
      history,
      userMessage: 'Why not a network issue?',
    });

    expect(messages[0]).toEqual({ role: 'system', content: CHAT_SYSTEM_PROMPT });
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('PRIOR DIAGNOSIS');
    expect(messages[1].content).toContain('DELIVERY HISTORY — 1 attempt(s)');
    // History replayed between context and the new question.
    expect(messages[2]).toEqual({ role: 'user', content: 'Earlier question?' });
    expect(messages[3]).toEqual({ role: 'assistant', content: 'Earlier answer.' });
    const last = messages[messages.length - 1];
    expect(last).toEqual({ role: 'user', content: 'Why not a network issue?' });
  });

  it('evicts the oldest turns to stay within the token budget, keeping the newest', () => {
    const question = 'Why not a network issue?';
    const longHistory: ChatHistoryRow[] = [];
    for (let i = 0; i < 10; i++) {
      longHistory.push({ role: 'user', content: `Q${i} ${'x'.repeat(400)}`, seq: i * 2 + 1 });
      longHistory.push({ role: 'assistant', content: `A${i} ${'y'.repeat(400)}`, seq: i * 2 + 2 });
    }

    // Size the budget to the fixed costs plus room for ~2 of the 10 turns.
    const contextBlock = `${buildDiagnosisSnapshot(diagnosis)}\n\n${buildLogContext(event)}`;
    const base =
      estimateTokens(CHAT_SYSTEM_PROMPT) + estimateTokens(contextBlock) + estimateTokens(question);
    const perTurn =
      estimateTokens(`Q0 ${'x'.repeat(400)}`) + estimateTokens(`A0 ${'y'.repeat(400)}`);
    const budget = base + perTurn * 2 + 1;

    const messages = assembleChatMessages({
      diagnosis,
      event,
      history: longHistory,
      userMessage: question,
      budget,
    });

    // Does not throw; the whole assembled request fits the budget.
    const total = messages.reduce((sum, m) => sum + estimateTokens(m.content ?? ''), 0);
    expect(total).toBeLessThanOrEqual(budget);

    // The budget leaves room for exactly 2 turns, so only the 2 newest survive: system + context +
    // 4 history rows (Q8/A8/Q9/A9) + the new question = 7 messages.
    expect(messages).toHaveLength(7);
    const joined = messages.map((m) => m.content ?? '').join('\n');
    expect(joined).toContain('Q8 ');
    expect(joined).toContain('Q9 ');
    expect(joined).not.toContain('Q7 ');
    expect(joined).not.toContain('Q0 ');
  });

  it('bounds the whole request for a many-attempts thread while keeping every attempt and its headers', () => {
    const question = 'Which attempt finally failed?';
    const attemptCount = 8;
    const manyAttempts: SerializableAttempt[] = Array.from({ length: attemptCount }, (_, i) => ({
      requestUrl: 'https://hooks.example-app.com/webhooks/stripe',
      requestMethod: 'POST',
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: { attempt: i },
      responseStatus: 429,
      // A citable header that must survive untruncated on every attempt.
      responseHeaders: { 'retry-after': `${i + 1}` },
      // A pathologically large body on every attempt — the thing the budget must rein in.
      responseBody: { blob: 'z'.repeat(4000), attempt: i },
      latencyMs: 100 + i,
      attemptedAt: new Date(`2026-01-01T00:0${i}:00.000Z`),
    }));
    const manyAttemptEvent: SerializableEvent = { ...event, attempts: manyAttempts };

    const budget = 3000;
    const messages = assembleChatMessages({
      diagnosis,
      event: manyAttemptEvent,
      history: [],
      userMessage: question,
      budget,
    });

    // The whole request stays within the per-request budget (not just the history).
    const total = messages.reduce((sum, m) => sum + estimateTokens(m.content ?? ''), 0);
    expect(total).toBeLessThanOrEqual(budget);

    const context = messages[1].content ?? '';
    // Every attempt is still present — indices stay stable so evidence citations keep resolving.
    for (let i = 0; i < attemptCount; i++) {
      expect(context).toContain(`attempts[${i}].responseStatus: 429`);
      expect(context).toContain(`attempts[${i}].responseHeaders: {"retry-after":"${i + 1}"}`);
    }
    // Bodies were truncated to fit; headers were not.
    expect(context).toContain('[truncated — showing first');
  });
});
