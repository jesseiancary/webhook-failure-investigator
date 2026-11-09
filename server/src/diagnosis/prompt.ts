import type { Diagnosis } from './diagnosis.schema.js';
import {
  formatValue,
  serializeAttempts,
  type SerializableEvent,
  type SerializableAttempt,
} from './serialize.js';

// The versioned prompt + the event→prompt serializer. This is the whole "grounding" surface for
// Phase 4: there are no retrieval tools yet (that's Phase 5), so the redacted event and its
// delivery attempts are serialized straight into the user message, and the system prompt enforces
// that every claim cite one of those fields. Bump PROMPT_VERSION on any wording change so the
// version stored on each Investigation stays an honest record of what produced it.

/** Stamped onto every Investigation so a diagnosis is traceable to the exact prompt that made it. */
export const PROMPT_VERSION = 'diagnosis-v1';

/** A chat message in the diagnosis request. PR2 maps these onto the OpenAI messages array. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// The event/attempt serializer and its structural types now live in ./serialize.ts so the Phase-5
// retrieval tools emit byte-identical field paths. Re-exported here because callers (and the prompt
// tests) have long imported the types from this module.
export type { SerializableEvent, SerializableAttempt };

export const SYSTEM_PROMPT = `You are the Webhook Failure Investigator. You diagnose why a single
webhook delivery failed, using ONLY the delivery logs provided in the user message.

Classify the failure into exactly one of these categories:
- authentication: the receiver rejected the credentials/signature (e.g. 401/403, WWW-Authenticate,
  invalid_token, signature mismatch).
- payload_validation: the receiver reached the handler but rejected the request body as malformed or
  incomplete (e.g. 400/422 with a validation error naming a field).
- timeout: the request exceeded a time limit with no usable response (e.g. an explicit timeout error,
  or very high latency with no status).
- network_failure: the request never reached the application (DNS failure, connection refused/reset,
  TLS error) — the endpoint was unreachable.
- rate_limit: the receiver throttled the request (e.g. 429, Retry-After, a rate-limit error body).
- server_error: the receiver reached the handler but failed internally (e.g. 500/502/503/504 with no
  rate-limit or auth signal).
- application_logic: the request succeeded at the transport level but the handler's business logic
  rejected or no-op'd it (e.g. a 200/409 whose body reports a logical rejection, idempotency skip,
  or domain error).
- insufficient_evidence: the logs are too thin or ambiguous to ground any of the above.

GROUNDING RULE (the core invariant — never break it):
- Every claim in rootCause and every item in evidence MUST cite a field from the logs below. Cite it
  by its field path: either a labeled line (e.g. attempts[0].responseStatus) or an index into the
  JSON value shown on such a line (e.g. attempts[0].responseBody.error.code,
  attempts[0].responseHeaders["www-authenticate"]).
- Never invent a status code, header, body value, or field that is not in the logs; never cite a
  value that does not appear in the serialized logs.
- When a field is absent, you may cite its documented absence by giving its path the value
  "(absent)" — that is how you ground an insufficient_evidence verdict.
- If the logs do not contain enough grounded signal to distinguish the categories — for example a
  bare connection drop with no response status, headers, or body — you MUST return
  failureCategory "insufficient_evidence" with isSpeculative true, rather than guessing a cause.
- isSpeculative is true whenever the diagnosis is not fully supported by cited evidence.

CONFIDENCE:
- Report calibrated confidence in [0,1]. High (>0.9) only when an unambiguous field names the cause
  (e.g. an explicit error code). Lower it when you are inferring from indirect signals. For
  insufficient_evidence, confidence should be low and isSpeculative true.

REACHABILITY:
- reachable: the receiver returned a response (any status). unreachable: the request failed before a
  response (DNS/connection/TLS). unknown: the logs don't say.

REMEDIATION:
- Give concrete, actionable steps tied to the grounded cause. For insufficient_evidence, recommend
  what additional log detail would make the failure diagnosable.

The event's secrets are already redacted to "[REDACTED]" before they reach you. Treat a [REDACTED]
value as present-but-hidden; never treat redaction itself as the failure cause.`;

/**
 * Serialize the redacted event + its delivery attempts into a stable, token-lean text block. Every
 * line is labeled with the exact field path the model should cite, so `evidence[].field` references
 * are grounded and mechanically checkable. Absent response fields are rendered as `(absent)` rather
 * than dropped, because their absence is itself diagnostic (it's the insufficient_evidence signal).
 */
export function buildUserMessage(event: SerializableEvent): string {
  const lines: string[] = [
    'WEBHOOK EVENT UNDER INVESTIGATION',
    'Cite evidence using the exact field paths shown below (e.g. attempts[0].responseStatus).',
    '',
    `source: ${formatValue(event.source)}`,
    `eventType: ${formatValue(event.eventType)}`,
    `payload: ${formatValue(event.payload)}`,
    `headers: ${formatValue(event.headers)}`,
    '',
    `attempts: ${event.attempts.length} delivery attempt(s)`,
    ...serializeAttempts(event.attempts),
  ];

  return lines.join('\n');
}

// Few-shot examples. These are illustrative, not exhaustive — the full taxonomy lives in
// SYSTEM_PROMPT; keeping the few-shot set small is deliberate cost discipline (every example rides
// in the prompt on every call). The chosen three teach the two edges of the grounding rule: a
// confidently grounded auth failure, a grounded payload-validation failure, and the refuse-to-guess
// insufficient_evidence case. Each user message is built through the real serializer so few-shot
// formatting is identical to production; each assistant diagnosis is typed `Diagnosis`, so the
// compiler guarantees it satisfies the structured-output contract.
interface FewShotExample {
  event: SerializableEvent;
  diagnosis: Diagnosis;
}

const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    event: {
      source: 'stripe',
      eventType: 'invoice.payment_failed',
      payload: { id: 'evt_1Pf2A', type: 'invoice.payment_failed' },
      headers: { 'stripe-signature': '[REDACTED]', 'content-type': 'application/json' },
      attempts: [
        {
          requestUrl: 'https://hooks.example-app.com/webhooks/stripe',
          requestMethod: 'POST',
          requestHeaders: { authorization: '[REDACTED]', 'stripe-signature': '[REDACTED]' },
          requestBody: { id: 'evt_1Pf2A', type: 'invoice.payment_failed' },
          responseStatus: 401,
          responseHeaders: { 'www-authenticate': 'Bearer realm="api", error="invalid_token"' },
          responseBody: {
            error: {
              type: 'invalid_request_error',
              code: 'api_key_expired',
              message: 'Expired API key provided.',
            },
          },
          latencyMs: 118,
        },
      ],
    },
    diagnosis: {
      failureCategory: 'authentication',
      rootCause:
        'The receiver rejected the delivery with HTTP 401 because the credential used to authenticate had expired — the response carries a WWW-Authenticate challenge and an api_key_expired error code.',
      confidence: 0.96,
      evidence: [
        {
          field: 'attempts[0].responseStatus',
          value: '401',
          note: 'Rejected on authentication, not processed.',
        },
        {
          field: 'attempts[0].responseHeaders["www-authenticate"]',
          value: 'Bearer realm="api", error="invalid_token"',
          note: 'The receiver signals a credential/token problem.',
        },
        {
          field: 'attempts[0].responseBody.error.code',
          value: 'api_key_expired',
          note: 'The receiver names the exact cause: the API key has expired.',
        },
      ],
      remediationSteps: [
        'Rotate the expired API key and update the webhook sender with the new credential.',
        'Re-send the failed delivery once the valid credential is in place.',
      ],
      reachabilityAssessment: 'reachable',
      isSpeculative: false,
    },
  },
  {
    event: {
      source: 'slack',
      eventType: 'event_callback',
      payload: { token: '[REDACTED]', team_id: 'T024BE7LD', type: 'event_callback' },
      headers: { 'x-slack-signature': '[REDACTED]', 'content-type': 'application/json' },
      attempts: [
        {
          requestUrl: 'https://hooks.example-app.com/webhooks/slack',
          requestMethod: 'POST',
          requestHeaders: { 'x-slack-signature': '[REDACTED]', 'content-type': 'application/json' },
          requestBody: { team_id: 'T024BE7LD', type: 'event_callback' },
          responseStatus: 400,
          responseHeaders: { 'content-type': 'application/json' },
          responseBody: {
            ok: false,
            error: 'invalid_payload',
            detail: 'missing required field: event',
          },
          latencyMs: 41,
        },
      ],
    },
    diagnosis: {
      failureCategory: 'payload_validation',
      rootCause:
        'The receiver reached its handler and rejected the request with HTTP 400 because the payload was missing a required field — the response body reports invalid_payload and names the missing "event" field.',
      confidence: 0.93,
      evidence: [
        {
          field: 'attempts[0].responseStatus',
          value: '400',
          note: 'Bad Request — the body was rejected, not the credentials.',
        },
        {
          field: 'attempts[0].responseBody.error',
          value: 'invalid_payload',
          note: 'The receiver classifies this as a payload problem.',
        },
        {
          field: 'attempts[0].responseBody.detail',
          value: 'missing required field: event',
          note: 'Names the exact missing field.',
        },
      ],
      remediationSteps: [
        'Include the required "event" field in the webhook payload before sending.',
        "Validate the payload against the receiver's expected schema in the sender.",
      ],
      reachabilityAssessment: 'reachable',
      isSpeculative: false,
    },
  },
  {
    event: {
      source: 'stripe',
      eventType: 'customer.updated',
      payload: { id: 'evt_1Pg7Q', type: 'customer.updated' },
      headers: { 'stripe-signature': '[REDACTED]', 'content-type': 'application/json' },
      attempts: [
        {
          requestUrl: 'https://hooks.example-app.com/webhooks/stripe',
          requestMethod: 'POST',
          requestHeaders: { 'stripe-signature': '[REDACTED]', 'content-type': 'application/json' },
          requestBody: { id: 'evt_1Pg7Q', type: 'customer.updated' },
          errorText: 'socket hang up',
        },
      ],
    },
    diagnosis: {
      failureCategory: 'insufficient_evidence',
      rootCause:
        'The only signal is a bare "socket hang up" with no response status, headers, or body. That is ambiguous between a timeout, a network fault, and the receiver crashing mid-response, so the cause cannot be grounded from these logs.',
      confidence: 0.2,
      evidence: [
        {
          field: 'attempts[0].errorText',
          value: 'socket hang up',
          note: 'A dropped connection that does not by itself identify the cause.',
        },
        {
          field: 'attempts[0].responseStatus',
          value: '(absent)',
          note: 'No response was recorded, so there is nothing to classify the failure against.',
        },
      ],
      remediationSteps: [
        'Capture transport-level detail (DNS resolution, TCP connect, TLS handshake, time-to-first-byte) on retry to distinguish a timeout from a network failure.',
        'Record any partial response or server-side log correlating to this delivery.',
      ],
      reachabilityAssessment: 'unknown',
      isSpeculative: true,
    },
  },
];

/**
 * The few-shot turns to inject between the system prompt and the real event, in order. Each example
 * becomes a user message (the serialized event) followed by the assistant's grounded diagnosis JSON.
 */
export const FEW_SHOT_MESSAGES: ChatMessage[] = FEW_SHOT_EXAMPLES.flatMap((example) => [
  { role: 'user', content: buildUserMessage(example.event) },
  { role: 'assistant', content: JSON.stringify(example.diagnosis) },
]);
