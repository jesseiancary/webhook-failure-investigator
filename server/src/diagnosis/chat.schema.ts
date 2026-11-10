import { z } from 'zod';

// The request contract for the follow-up chat endpoint. Per CLAUDE.md's single-source-shapes rule
// this Zod schema is the one definition of a chat request — the route validates the body against it
// (400 on failure) and callers derive the `ChatRequest` type from it. `.min(1)` rejects an empty or
// whitespace-only question before any model call, so an empty turn never reaches the context builder.

/** A follow-up question scoped to one investigation. */
export const ChatRequestSchema = z.object({
  /** The user's question. Non-empty; trimmed so a whitespace-only message is a 400, not a blank turn. */
  message: z.string().trim().min(1),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
