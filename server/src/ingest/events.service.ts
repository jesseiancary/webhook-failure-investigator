import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { redactHeaders, redactJson } from './redact.js';
import type { ManualSubmission } from './schemas.js';

// The ingest service — the single place where webhook data is written, and therefore the
// single redaction choke point. Both manual submission (PR2) and live capture (PR3) call
// createEvent, so secrets are stripped on every path before anything reaches the database.

function toJson(value: unknown): Prisma.InputJsonValue {
  return redactJson(value) as Prisma.InputJsonValue;
}

function toJsonHeaders(headers: ManualSubmission['headers']): Prisma.InputJsonValue {
  return redactHeaders(headers) as Prisma.InputJsonValue;
}

/**
 * Persist a webhook event and its delivery attempts, redacting secrets along the way. Both manual
 * submission and live capture flow through here; `opts.captureEndpointId` links a captured event
 * to the endpoint it arrived on (manual submissions pass nothing and stay unlinked).
 * `opts.id` lets the seed loader supply a stable id (e.g. `seed_stripe_auth_401`) for idempotent
 * re-seeding; omitted everywhere else, so Prisma falls back to the `@default(cuid())`.
 */
export async function createEvent(
  input: ManualSubmission,
  opts?: { captureEndpointId?: string; id?: string },
) {
  return prisma.webhookEvent.create({
    data: {
      id: opts?.id,
      source: input.source,
      eventType: input.eventType,
      payload: toJson(input.payload ?? {}),
      headers: toJsonHeaders(input.headers),
      captureEndpoint:
        opts?.captureEndpointId !== undefined
          ? { connect: { id: opts.captureEndpointId } }
          : undefined,
      attempts: {
        create: input.attempts.map((attempt) => ({
          requestUrl: attempt.requestUrl,
          requestMethod: attempt.requestMethod,
          requestHeaders: toJsonHeaders(attempt.requestHeaders),
          // `== null` (not `=== undefined`): an explicit JSON `null` body is stored as SQL NULL
          // too. Prisma rejects a raw JS `null` for a `Json?` column (it wants Prisma.JsonNull),
          // so this also prevents a null body from 500ing at persistence.
          requestBody: attempt.requestBody == null ? undefined : toJson(attempt.requestBody),
          responseStatus: attempt.responseStatus,
          responseHeaders:
            attempt.responseHeaders == null ? undefined : toJsonHeaders(attempt.responseHeaders),
          responseBody: attempt.responseBody == null ? undefined : toJson(attempt.responseBody),
          latencyMs: attempt.latencyMs,
          errorText: attempt.errorText,
          attemptedAt: attempt.attemptedAt,
        })),
      },
    },
    include: { attempts: true },
  });
}

/**
 * List events newest-first as dashboard summaries — no bodies, no diagnosis blob. Each row carries
 * what the Phase 7 dashboard's four filters need from one request: the attempt count, a
 * failure-biased response status (for the HTTP-status filter), and the latest investigation's
 * category + confidence (for the category badge and the investigated-state filter).
 *
 * `primaryResponseStatus` is the HIGHEST response status across the event's attempts, not the last
 * one: attempts from a single submission share an identical `attemptedAt` (`@default(now())` is the
 * transaction timestamp) and there is no insertion-order column, so "most recent" would be a
 * non-deterministic tie. Taking the max is order-independent and, because any 4xx/5xx outranks a
 * 2xx/3xx, surfaces a failing delivery's failure (429→200 ⇒ 429). Null when no attempt recorded a
 * status (e.g. a pure network failure). `latestInvestigation` is null until the event is investigated.
 */
export async function listEvents() {
  const events = await prisma.webhookEvent.findMany({
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true,
      source: true,
      eventType: true,
      receivedAt: true,
      // No capture secret here: the token lives on CaptureEndpoint, never on the event.
      attempts: { select: { responseStatus: true } },
      // `id` breaks a createdAt tie deterministically so the badge is stable across requests.
      investigations: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { failureCategory: true, confidence: true },
      },
    },
  });

  return events.map((event) => {
    const statuses = event.attempts
      .map((attempt) => attempt.responseStatus)
      .filter((status): status is number => status != null);
    return {
      id: event.id,
      source: event.source,
      eventType: event.eventType,
      receivedAt: event.receivedAt,
      attemptCount: event.attempts.length,
      primaryResponseStatus: statuses.length > 0 ? Math.max(...statuses) : null,
      // Flatten the take:1 relation so the client never sees a misleading array-of-one (this is
      // "the latest run", not the full history — which loads via GET /events/:id/investigations).
      latestInvestigation: event.investigations[0] ?? null,
    };
  });
}

/** Fetch one event with its delivery attempts (oldest first). `null` when not found. */
export async function getEventById(id: string) {
  return prisma.webhookEvent.findUnique({
    where: { id },
    include: { attempts: { orderBy: { attemptedAt: 'asc' } } },
  });
}
