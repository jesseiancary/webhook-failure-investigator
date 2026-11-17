import { z } from 'zod';

// Shared ingest schemas. Per CLAUDE.md's "single-source shapes" rule these Zod schemas are
// the one definition of the manual-submission contract — reused by server API validation and by
// the web submission form (`ManualSubmissionInput`). Do not duplicate these shapes elsewhere.
// (The live-capture endpoint schema is server-internal and stays in server/src/ingest/schemas.ts.)

/** A header map: string names to a string value or a list of values (e.g. Set-Cookie). */
export const HeadersSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

/** One delivery attempt for an event — the request made and the response (or error) observed. */
export const AttemptSchema = z.object({
  requestUrl: z.string().url(),
  requestMethod: z.string().min(1),
  requestHeaders: HeadersSchema,
  requestBody: z.unknown().optional(),
  responseStatus: z.number().int().optional(),
  responseHeaders: HeadersSchema.optional(),
  responseBody: z.unknown().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  errorText: z.string().optional(),
  attemptedAt: z.coerce.date().optional(),
});

/** The `POST /events` body: an inbound event plus one or more delivery attempts. */
export const ManualSubmissionSchema = z.object({
  source: z.string().min(1),
  eventType: z.string().min(1),
  payload: z.unknown(),
  headers: HeadersSchema,
  attempts: z.array(AttemptSchema).min(1),
});

export type Headers = z.infer<typeof HeadersSchema>;
export type Attempt = z.infer<typeof AttemptSchema>;
export type ManualSubmission = z.infer<typeof ManualSubmissionSchema>;
