import { randomBytes } from 'node:crypto';
import { prisma } from '../db/client.js';
import { createEvent } from './events.service.js';
import type { HeaderMap } from './redact.js';
import type { CaptureEndpointInput, ManualSubmission } from './schemas.js';

// Live capture (POST /capture/:token). A capture URL is backed by a persisted, minted token on a
// CaptureEndpoint; each inbound delivery becomes a WebhookEvent + one DeliveryAttempt. Persistence
// reuses events.service.createEvent, so secrets are redacted on this path too — no new redaction.

/**
 * Generate a capture token. This is a bearer secret (anyone holding it can POST to the endpoint),
 * so it uses a CSPRNG — 24 bytes ≈ 192 bits — rendered URL-safe for the `/capture/:token` path.
 */
export function generateCaptureToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Mint a capture endpoint. The returned record includes the secret `token` (shown once). */
export async function createCaptureEndpoint(input: CaptureEndpointInput) {
  return prisma.captureEndpoint.create({
    data: { token: generateCaptureToken(), source: input.source, name: input.name },
  });
}

/** List capture endpoints newest-first. The secret `token` is deliberately not selected. */
export async function listCaptureEndpoints() {
  return prisma.captureEndpoint.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      source: true,
      name: true,
      createdAt: true,
      _count: { select: { events: true } },
    },
  });
}

/** Look up an endpoint by its URL token. `null` when the token is unknown (→ 404 at the route). */
export async function getCaptureEndpointByToken(token: string) {
  return prisma.captureEndpoint.findUnique({ where: { token } });
}

/** Drop `undefined`-valued headers (Node's IncomingHttpHeaders) down to a concrete HeaderMap. */
export function toHeaderMap(headers: Record<string, string | string[] | undefined>): HeaderMap {
  const result: HeaderMap = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) result[name] = value;
  }
  return result;
}

/** Case-insensitive single-value header lookup (first value when the header repeats). */
function headerValue(headers: HeaderMap, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

/**
 * Best-effort source/eventType from the provider's well-known signals: a Stripe/Slack signature
 * header or GitHub's event header identifies the source; the event type comes from the body
 * (`type`/`event`) or GitHub's header. Falls back to the endpoint's declared source and `unknown`.
 * Pure — unit-tested without a database.
 */
export function inferSourceAndType(
  headers: HeaderMap,
  body: unknown,
  defaultSource?: string,
): { source: string; eventType: string } {
  let source = defaultSource ?? 'unknown';
  if (headerValue(headers, 'stripe-signature') !== undefined) source = 'stripe';
  else if (headerValue(headers, 'x-github-event') !== undefined) source = 'github';
  else if (headerValue(headers, 'x-slack-signature') !== undefined) source = 'slack';

  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const eventType =
    (typeof record.type === 'string' && record.type) ||
    (typeof record.event === 'string' && record.event) ||
    headerValue(headers, 'x-github-event') ||
    'unknown';

  return { source, eventType };
}

/** Record one inbound webhook against its endpoint, redacting secrets via createEvent. */
export async function captureWebhook(
  endpoint: { id: string; source: string | null },
  captured: { url: string; headers: HeaderMap; body: unknown },
) {
  const { source, eventType } = inferSourceAndType(
    captured.headers,
    captured.body,
    endpoint.source ?? undefined,
  );

  const submission: ManualSubmission = {
    source,
    eventType,
    payload: captured.body ?? {},
    headers: captured.headers,
    attempts: [
      {
        requestUrl: captured.url,
        requestMethod: 'POST',
        requestHeaders: captured.headers,
        requestBody: captured.body,
        // Our acknowledgement back to the provider — this endpoint is the receiver.
        responseStatus: 202,
        responseBody: { received: true },
      },
    ],
  };

  return createEvent(submission, { captureEndpointId: endpoint.id });
}
