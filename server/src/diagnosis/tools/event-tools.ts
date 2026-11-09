import type { DeliveryAttempt } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { redactHeaders, redactJson, type HeaderMap } from '../../ingest/redact.js';
import { formatValue, serializeAttempts, type SerializableAttempt } from '../serialize.js';

// The event-scoped retrieval tools the model calls instead of receiving a raw data dump:
// `get_event_payload(eventId)` → the event envelope (source/type/payload/headers),
// `get_delivery_history(eventId)` → every delivery attempt, oldest-first serialized with the same
// citable `attempts[i].field` paths the diagnosis must reference (oldest-first keeps `attempts[0]`
// the same attempt as the inline `buildUserMessage` path). Data is already redacted at rest
// (events.service is the write-time choke point); we re-redact defensively on read so a tool can
// never be the path a secret leaks through.

/** Re-redact a stored headers value. Already redacted on write; this is belt-and-suspenders. */
function redactHeadersView(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return redactHeaders(value as HeaderMap);
  }
  return value;
}

/** Re-redact a stored body value (JSON or null). Already redacted on write; defensive on read. */
function redactBodyView(value: unknown): unknown {
  return value == null ? value : redactJson(value);
}

/** A stored attempt re-redacted for serialization — mirrors the write-time redaction defensively. */
function redactAttempt(attempt: DeliveryAttempt): SerializableAttempt {
  return {
    requestUrl: attempt.requestUrl,
    requestMethod: attempt.requestMethod,
    requestHeaders: redactHeadersView(attempt.requestHeaders),
    requestBody: redactBodyView(attempt.requestBody),
    responseStatus: attempt.responseStatus,
    responseHeaders: redactHeadersView(attempt.responseHeaders),
    responseBody: redactBodyView(attempt.responseBody),
    latencyMs: attempt.latencyMs,
    errorText: attempt.errorText,
    attemptedAt: attempt.attemptedAt,
  };
}

/**
 * `get_event_payload` executor: return the event envelope as a citable text block. `null` event →
 * an explicit not-found string so the model gets an honest signal rather than inventing a payload.
 */
export async function getEventPayload(eventId: string): Promise<string> {
  // Only the envelope columns are read here — select them directly rather than loading every
  // delivery attempt (that's `get_delivery_history`'s job).
  const event = await prisma.webhookEvent.findUnique({
    where: { id: eventId },
    select: { source: true, eventType: true, payload: true, headers: true },
  });
  if (event === null) {
    return `No event found with id "${eventId}".`;
  }

  return [
    'EVENT PAYLOAD',
    'Cite evidence using the exact field paths shown below (e.g. payload.id, headers["content-type"]).',
    '',
    `source: ${formatValue(event.source)}`,
    `eventType: ${formatValue(event.eventType)}`,
    `payload: ${formatValue(redactBodyView(event.payload))}`,
    `headers: ${formatValue(redactHeadersView(event.headers))}`,
  ].join('\n');
}

/**
 * `get_delivery_history` executor: every delivery attempt for the event, oldest-first, serialized
 * with the shared `attempts[i].field` labeling so citations resolve identically to the inline path.
 * Zero rows (unknown event or an event with no attempts) renders as `0 attempt(s)` — a thin-logs
 * signal the model should ground an insufficient_evidence verdict on rather than guess past.
 */
export async function getDeliveryHistory(eventId: string): Promise<string> {
  const attempts = await prisma.deliveryAttempt.findMany({
    where: { eventId },
    orderBy: { attemptedAt: 'asc' },
  });

  return [
    `DELIVERY HISTORY — ${attempts.length} attempt(s)`,
    'Cite evidence using the exact field paths shown below (e.g. attempts[0].responseStatus).',
    ...serializeAttempts(attempts.map(redactAttempt)),
  ].join('\n');
}
