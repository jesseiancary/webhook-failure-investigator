import { z } from 'zod';

// The manual-submission contract (headers, attempts, event body) now lives in @wfi/contracts, shared
// with the web submission form. Re-exported here under the server's historical module path so
// existing importers are unchanged. The live-capture endpoint schema below is server-internal (the
// web UI never mints capture endpoints), so it stays local.
export { HeadersSchema, AttemptSchema, ManualSubmissionSchema } from '@wfi/contracts';
export type { Headers, Attempt, ManualSubmission } from '@wfi/contracts';

/** Body for minting a live-capture endpoint (`POST /capture-endpoints`). Both fields optional. */
export const CaptureEndpointInputSchema = z.object({
  source: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

export type CaptureEndpointInput = z.infer<typeof CaptureEndpointInputSchema>;
