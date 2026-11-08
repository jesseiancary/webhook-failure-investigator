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
 */
export async function createEvent(input: ManualSubmission, opts?: { captureEndpointId?: string }) {
  return prisma.webhookEvent.create({
    data: {
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

/** List events newest-first with an attempt count — summary view, no bodies. */
export async function listEvents() {
  return prisma.webhookEvent.findMany({
    orderBy: { receivedAt: 'desc' },
    select: {
      id: true,
      source: true,
      eventType: true,
      receivedAt: true,
      // No capture secret here: the token lives on CaptureEndpoint, never on the event.
      _count: { select: { attempts: true } },
    },
  });
}

/** Fetch one event with its delivery attempts (oldest first). `null` when not found. */
export async function getEventById(id: string) {
  return prisma.webhookEvent.findUnique({
    where: { id },
    include: { attempts: { orderBy: { attemptedAt: 'asc' } } },
  });
}
