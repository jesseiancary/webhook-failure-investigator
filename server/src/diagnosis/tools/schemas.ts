import { z } from 'zod';

// Tool parameter schemas — the single definition of each retrieval tool's arguments, per the
// CLAUDE.md "define Zod once" rule. In Phase 5 PR2 these drive BOTH the OpenAI function definitions
// (schema → JSON Schema for the `tools` array) AND runtime validation of the model-supplied
// arguments before an executor runs. PR1 defines them alongside the executors they validate.

/** Args for the event-scoped tools (`get_event_payload`, `get_delivery_history`). */
export const EventToolParamsSchema = z.object({
  eventId: z.string().min(1),
});

/** Args for `fetch_api_docs`: which provider's reference docs to search, and the keyword query. */
export const FetchApiDocsParamsSchema = z.object({
  provider: z.string().min(1),
  query: z.string().min(1),
});

export type EventToolParams = z.infer<typeof EventToolParamsSchema>;
export type FetchApiDocsParams = z.infer<typeof FetchApiDocsParamsSchema>;
