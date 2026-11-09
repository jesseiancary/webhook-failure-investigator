import type { Diagnosis } from './diagnosis.schema.js';
import {
  formatDeliveryHistoryBlock,
  formatEventPayloadBlock,
  type SerializableAttempt,
  type SerializableEnvelope,
  type SerializableEvent,
} from './serialize.js';

// The versioned prompt + the investigation-request builder. Phase 5 turns the Phase-4 "raw data
// dump" into a retrieval task: the user message names only the event, and the model must pull the
// payload and delivery history through tools before diagnosing. The system prompt still enforces the
// grounding invariant — every claim cites a field returned by a tool — now pointed at tool results
// instead of an inlined block. Bump PROMPT_VERSION on any wording change so the version stored on
// each Investigation stays an honest record of what produced it.

/** Stamped onto every Investigation so a diagnosis is traceable to the exact prompt that made it. */
export const PROMPT_VERSION = 'diagnosis-v2';

/** A tool call the model made (or a few-shot demonstrates): which function, and its JSON arguments. */
export interface ToolCall {
  /** The provider-assigned call id; a `tool` message echoes it as `toolCallId` to pair the result. */
  id: string;
  /** The tool/function name, e.g. `get_delivery_history`. */
  name: string;
  /** The arguments as a JSON string, exactly as the model emits them (validated before execution). */
  arguments: string;
}

/**
 * A chat message in the diagnosis request. A discriminated union over the OpenAI roles so the
 * tool-calling loop is type-checked end to end: an `assistant` turn may carry `toolCalls`, and a
 * `tool` turn carries the result paired to a call by `toolCallId`. `openai.ts` maps these onto the
 * OpenAI messages array.
 */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

// The event/attempt serializer and its structural types live in ./serialize.ts so the Phase-5
// retrieval tools emit byte-identical field paths. Re-exported here because callers (and the prompt
// tests) have long imported the types from this module.
export type { SerializableEvent, SerializableAttempt };

export const SYSTEM_PROMPT = `You are the Webhook Failure Investigator. You diagnose why a single
webhook delivery failed, using ONLY the delivery logs you retrieve through the provided tools.

RETRIEVAL (how you get the logs):
- The user message names the event under investigation (eventId, source, eventType, attempt count)
  but contains no log data. You MUST retrieve the data before you diagnose:
  - get_event_payload(eventId): the event envelope — source, eventType, payload, headers.
  - get_delivery_history(eventId): every delivery attempt, oldest-first, with citable
    attempts[i].field paths.
  - fetch_api_docs(provider, query): reference docs for a provider's webhook behavior (signature
    verification, auth, rate limits, payload shape). Call it only when provider behavior is in doubt.
- Always call get_event_payload AND get_delivery_history for the event before answering. Pass the
  exact eventId from the user message; the tools are scoped to that event.
- When a tool returns no usable data (an unknown event, 0 attempts, "(absent)" fields), treat that
  thinness as evidence — it is not a license to guess.

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
- Every claim in rootCause and every item in evidence MUST cite a field from the delivery logs the
  tools returned. Cite it by its field path: either a labeled line (e.g. attempts[0].responseStatus)
  or an index into the JSON value shown on such a line (e.g. attempts[0].responseBody.error.code,
  attempts[0].responseHeaders["www-authenticate"]).
- Never invent a status code, header, body value, or field that no tool returned; never cite a value
  that does not appear in a tool result.
- API reference docs from fetch_api_docs are background material. They may inform rootCause and
  remediationSteps, but they are NOT delivery-log evidence: never cite doc text in evidence[].
  evidence[] cites only fields returned by get_event_payload / get_delivery_history.
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

The event's secrets are already redacted to "[REDACTED]" before any tool returns them. Treat a
[REDACTED] value as present-but-hidden; never treat redaction itself as the failure cause.`;

/** The minimal set of facts the investigation-request user message names (the model retrieves the rest). */
export interface InvestigationRequest {
  eventId: string;
  source: string;
  eventType: string;
  attemptCount: number;
}

/**
 * Build the investigation-request user message: it names the event and instructs retrieval, but
 * carries no log data — the model must pull the payload and delivery history through the tools
 * (diagnosis-v2). This is the retrieval-first inversion of the Phase-4 inlined block; grounding now
 * happens against tool results, which the system prompt enforces.
 */
export function buildUserMessage(request: InvestigationRequest): string {
  return [
    'WEBHOOK DELIVERY UNDER INVESTIGATION',
    `eventId: ${request.eventId}`,
    `source: ${request.source}`,
    `eventType: ${request.eventType}`,
    `attempts recorded: ${request.attemptCount}`,
    '',
    'Retrieve the delivery logs before diagnosing: call get_event_payload and get_delivery_history',
    'for this eventId (and fetch_api_docs when provider behavior is in question), then ground every',
    'claim in the fields those tools return.',
  ].join('\n');
}

// Few-shot examples, reworked into tool-calling form for diagnosis-v2. The set is deliberately small
// (every example rides in the prompt on every call) and teaches the two edges of the grounding rule:
// a confidently grounded auth failure, and the refuse-to-guess insufficient_evidence case. Each
// example is a full retrieval trajectory — request → get_event_payload → get_delivery_history →
// grounded diagnosis — with the tool results rendered through the SAME serializer the live tools use,
// so the demonstrated format is identical to production. Each diagnosis is typed `Diagnosis`, so the
// compiler guarantees it satisfies the structured-output contract.
interface FewShotExample {
  eventId: string;
  source: string;
  eventType: string;
  /** The already-redacted envelope the `get_event_payload` result renders from. */
  envelope: SerializableEnvelope;
  /** The already-redacted attempts the `get_delivery_history` result renders from. */
  attempts: SerializableAttempt[];
  diagnosis: Diagnosis;
}

const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  {
    eventId: 'evt_example_auth_401',
    source: 'stripe',
    eventType: 'invoice.payment_failed',
    envelope: {
      source: 'stripe',
      eventType: 'invoice.payment_failed',
      payload: { id: 'evt_1Pf2A', type: 'invoice.payment_failed' },
      headers: { 'stripe-signature': '[REDACTED]', 'content-type': 'application/json' },
    },
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
    eventId: 'evt_example_insufficient',
    source: 'stripe',
    eventType: 'customer.updated',
    envelope: {
      source: 'stripe',
      eventType: 'customer.updated',
      payload: { id: 'evt_1Pg7Q', type: 'customer.updated' },
      headers: { 'stripe-signature': '[REDACTED]', 'content-type': 'application/json' },
    },
    attempts: [
      {
        requestUrl: 'https://hooks.example-app.com/webhooks/stripe',
        requestMethod: 'POST',
        requestHeaders: { 'stripe-signature': '[REDACTED]', 'content-type': 'application/json' },
        requestBody: { id: 'evt_1Pg7Q', type: 'customer.updated' },
        errorText: 'socket hang up',
      },
    ],
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
 * The few-shot turns to inject between the system prompt and the real request, in order. Each
 * example expands into a full retrieval trajectory: the investigation request, an assistant
 * get_event_payload call and its tool result, an assistant get_delivery_history call and its tool
 * result, then the grounded diagnosis. Tool results are built through the live serializer so the
 * demonstrated format matches what the tools actually return at inference time.
 */
export const FEW_SHOT_MESSAGES: ChatMessage[] = FEW_SHOT_EXAMPLES.flatMap(
  (example): ChatMessage[] => {
    const argumentsJson = JSON.stringify({ eventId: example.eventId });
    const payloadCallId = `call_${example.eventId}_payload`;
    const historyCallId = `call_${example.eventId}_history`;

    return [
      {
        role: 'user',
        content: buildUserMessage({
          eventId: example.eventId,
          source: example.source,
          eventType: example.eventType,
          attemptCount: example.attempts.length,
        }),
      },
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: payloadCallId, name: 'get_event_payload', arguments: argumentsJson }],
      },
      {
        role: 'tool',
        toolCallId: payloadCallId,
        content: formatEventPayloadBlock(example.envelope),
      },
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: historyCallId, name: 'get_delivery_history', arguments: argumentsJson }],
      },
      {
        role: 'tool',
        toolCallId: historyCallId,
        content: formatDeliveryHistoryBlock(example.attempts),
      },
      { role: 'assistant', content: JSON.stringify(example.diagnosis) },
    ];
  },
);
