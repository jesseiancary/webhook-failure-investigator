// Response shapes returned by the server API, as they appear over the wire (JSON): Prisma `DateTime`
// → ISO string, Prisma `Decimal` (costUsd) → string, `Json` columns → unknown.
//
// These are the canonical definition of the HTTP response contract the web UI consumes. They are
// deliberately hand-written interfaces, NOT `z.infer`'d: the shapes above have no input Zod schema —
// they're produced by Prisma projections in the server services and serialized by Express's
// `res.json` (which invokes `Decimal.prototype.toJSON()` / `Date.prototype.toISOString()`). Keep them
// in lockstep with those projections (server/src/ingest/events.service.ts and
// server/src/diagnosis/diagnosis.service.ts); the server integration tests are the contract of record.

import type { Diagnosis } from './diagnosis.schema.js';
import type { FailureCategory } from './failure-category.js';

/** One delivery attempt, redacted server-side (mirrors the DeliveryAttempt model). */
export interface DeliveryAttempt {
  id: string;
  eventId: string;
  requestUrl: string;
  requestMethod: string;
  requestHeaders: unknown;
  requestBody: unknown;
  responseStatus: number | null;
  responseHeaders: unknown;
  responseBody: unknown;
  latencyMs: number | null;
  errorText: string | null;
  attemptedAt: string;
}

/** A dashboard summary row from `GET /events` (mirrors listEvents). */
export interface EventSummary {
  id: string;
  source: string;
  eventType: string;
  receivedAt: string;
  attemptCount: number;
  /** Failure-biased status (highest across attempts); null when no attempt recorded a status. */
  primaryResponseStatus: number | null;
  latestInvestigation: { failureCategory: FailureCategory; confidence: number } | null;
}

/** A full event with its delivery attempts, from `GET /events/:id` (mirrors getEventById). */
export interface EventDetail {
  id: string;
  source: string;
  eventType: string;
  payload: unknown;
  headers: unknown;
  receivedAt: string;
  captureEndpointId: string | null;
  attempts: DeliveryAttempt[];
}

/** A chat/trace message on an investigation (mirrors the InvestigationMessage model). */
export interface InvestigationMessage {
  id: string;
  investigationId: string;
  role: string;
  content: string;
  toolCalls: unknown;
  seq: number;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: string | null;
  createdAt: string;
}

/** A summary row from `GET /events/:id/investigations` (mirrors listInvestigations projection). */
export interface InvestigationSummary {
  id: string;
  failureCategory: FailureCategory;
  confidence: number;
  model: string;
  costUsd: string;
  createdAt: string;
}

/** A persisted investigation row, as returned by `POST /events/:id/investigate` (no relations). */
export interface InvestigationRecord {
  id: string;
  eventId: string;
  diagnosis: Diagnosis;
  failureCategory: FailureCategory;
  confidence: number;
  model: string;
  promptVersion: string | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: string;
  createdAt: string;
}

/**
 * One investigation with the event it diagnosed and its message thread, from `GET /investigations/:id`.
 * The detail view loads this after kicking off a run; `POST .../investigate` returns the bare
 * InvestigationRecord above, so relations are fetched here.
 */
export interface Investigation extends InvestigationRecord {
  event: EventDetail;
  messages: InvestigationMessage[];
}

/**
 * The request body for `POST /events` (the client-constructed JSON, mirroring ManualSubmissionSchema).
 * Hand-written rather than `z.infer`'d because the wire form carries dates as ISO strings, whereas the
 * server schema's `z.coerce.date()` parses them to `Date` on the way in.
 */
export interface ManualSubmissionInput {
  source: string;
  eventType: string;
  payload: unknown;
  headers: Record<string, string | string[]>;
  attempts: Array<{
    requestUrl: string;
    requestMethod: string;
    requestHeaders: Record<string, string | string[]>;
    requestBody?: unknown;
    responseStatus?: number;
    responseHeaders?: Record<string, string | string[]>;
    responseBody?: unknown;
    latencyMs?: number;
    errorText?: string;
    attemptedAt?: string;
  }>;
}
