// Response shapes returned by the server API, as they appear over the wire (JSON): `DateTime` →
// ISO string, Prisma `Decimal` (costUsd) → string, `Json` columns → unknown.
//
// Single-source intent (CLAUDE.md): the canonical definitions live in the server's Zod schemas
// (server/src/diagnosis/diagnosis.schema.ts, server/src/ingest/schemas.ts) and Prisma models. A
// direct cross-workspace `import type` is awkward here — the server uses NodeNext `.js` specifiers
// and isn't published as a package, and web's `rootDir: src` rejects importing files above it — so
// these mirror only the *response* shapes the UI consumes. Keep them in lockstep with the server;
// the integration tests there are the contract of record.
//
// TODO(phase-7+): this mirror is an accepted tradeoff, not a verified dead end — a direct import
// was not spiked. If web/server drift becomes a problem, revisit via a shared `@wfi/contracts`
// package (the Zod schemas + inferred types) that both workspaces import, rather than widening the
// build graph ad hoc. No compile-time guard links these to the server today.

/** The failure taxonomy (mirrors FAILURE_CATEGORIES / the Prisma `FailureCategory` enum). */
export type FailureCategory =
  | 'authentication'
  | 'payload_validation'
  | 'timeout'
  | 'network_failure'
  | 'rate_limit'
  | 'server_error'
  | 'application_logic'
  | 'insufficient_evidence';

export type Reachability = 'reachable' | 'unreachable' | 'unknown';

/** One grounded citation (mirrors EvidenceSchema). */
export interface Evidence {
  field: string;
  value: string;
  note: string;
}

/** A structured, grounded diagnosis (mirrors DiagnosisSchema). */
export interface Diagnosis {
  failureCategory: FailureCategory;
  rootCause: string;
  confidence: number;
  evidence: Evidence[];
  remediationSteps: string[];
  reachabilityAssessment: Reachability;
  isSpeculative: boolean;
}

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

/** The request body for `POST /events` (mirrors ManualSubmissionSchema). */
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
