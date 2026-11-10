import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { getEventById } from '../ingest/events.service.js';
import type { Diagnosis } from './diagnosis.schema.js';
import {
  createOpenAIDiagnosisClient,
  type DiagnosisClient,
  type PersistedToolCall,
} from './openai.js';
import { computeCostUsd } from './pricing.js';
import {
  FEW_SHOT_MESSAGES,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserMessage,
  type ChatMessage,
} from './prompt.js';
import { buildDiagnosisToolkit } from './tools/index.js';

// The orchestration: stored event → grounded, persisted Investigation. This is the single place the
// prompt, the model call, cost accounting, and persistence come together. The `client` seam lets
// the route pass nothing (real OpenAI) while tests inject a deterministic stub, so the whole flow —
// message assembly, column hoisting, cost math — is exercised without the network.

// Prisma types a `Json` column as the recursive `InputJsonValue`. A concrete typed object like
// `Diagnosis` is structurally a JSON value but TS can't prove it against that recursive type, so the
// cast is unavoidable — localized here (mirroring ingest's `toJson`) rather than inlined at the
// call site. The value is already schema-validated by `DiagnosisSchema.parse` before it gets here.
function toDiagnosisJson(diagnosis: Diagnosis): Prisma.InputJsonValue {
  return diagnosis as unknown as Prisma.InputJsonValue;
}

/**
 * Turn the tool calls made during the loop into the nested InvestigationMessage rows persisted with
 * the Investigation. Each call becomes an `assistant` row carrying the requested call in `toolCalls`
 * Json, followed by the `tool` row carrying the result it fed back — a faithful, replayable trace of
 * the retrieval the diagnosis was grounded in (and the thread Phase-6 chat extends). One call per
 * assistant row keeps every row self-contained: a valid assistant→tool pair on its own.
 */
function toInvestigationMessages(
  toolCalls: PersistedToolCall[],
): Prisma.InvestigationMessageCreateWithoutInvestigationInput[] {
  return toolCalls.flatMap((call) => [
    {
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: call.id, name: call.name, arguments: call.arguments },
      ] as Prisma.InputJsonValue,
    },
    { role: 'tool', content: call.result },
  ]);
}

/**
 * Investigate one stored event and persist the resulting Investigation. Returns `null` when the
 * event does not exist (the route maps that to a 404); otherwise returns the created row.
 */
export async function investigateEvent(eventId: string, opts?: { client?: DiagnosisClient }) {
  const event = await getEventById(eventId);
  if (event === null) {
    return null;
  }

  // System prompt + the curated few-shot turns + the investigation request. diagnosis-v2 no longer
  // inlines the event: the request names it, and the model retrieves the payload/history through the
  // toolkit (bound to this event, below) before diagnosing.
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...FEW_SHOT_MESSAGES,
    {
      role: 'user',
      content: buildUserMessage({
        eventId: event.id,
        source: event.source,
        eventType: event.eventType,
        attemptCount: event.attempts.length,
      }),
    },
  ];

  // The toolkit is scoped to this event, so the retrieval tools can only read the event under
  // investigation (see buildDiagnosisToolkit).
  const toolkit = buildDiagnosisToolkit(event.id);
  const client = opts?.client ?? createOpenAIDiagnosisClient();
  const { diagnosis, usage, model, toolCalls } = await client.runDiagnosis(messages, toolkit);

  const costUsd = computeCostUsd(model, usage.promptTokens, usage.completionTokens);

  // Persist the full diagnosis as Json and hoist the queryable fields to columns; nest the retrieval
  // trace as InvestigationMessage rows (assistant tool-call + tool-result pairs). `promptVersion`
  // records which prompt produced it; `model`/token/cost fields are the accounting the CLAUDE.md
  // rule requires on every LLM-produced Investigation (now summed across every call in the loop).
  return prisma.investigation.create({
    data: {
      event: { connect: { id: event.id } },
      diagnosis: toDiagnosisJson(diagnosis),
      failureCategory: diagnosis.failureCategory,
      confidence: diagnosis.confidence,
      model,
      promptVersion: PROMPT_VERSION,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd,
      messages: { create: toInvestigationMessages(toolCalls) },
    },
  });
}

/**
 * List prior investigations for one event, newest-first. An event can be investigated more than once
 * (re-runs after a prompt/model change), so the Phase 7 UI shows the history. Returns `null` when the
 * event itself doesn't exist (the route maps that to a 404, distinct from an existing event with no
 * runs, which returns `[]`).
 */
export async function listInvestigations(eventId: string) {
  const event = await prisma.webhookEvent.findUnique({
    where: { id: eventId },
    include: { investigations: { orderBy: { createdAt: 'desc' } } },
  });
  return event === null ? null : event.investigations;
}

/**
 * Fetch one investigation by its own id, with the event + delivery attempts it diagnosed and its
 * message thread (ordered by `seq` for deterministic replay). This is what Phase-6 chat loads per
 * turn: the diagnosis to anchor the context, the logs to re-serialize into it, and the prior chat
 * turns to replay. Returns `null` when the investigation doesn't exist (the route maps that to 404).
 */
export async function getInvestigationById(id: string) {
  return prisma.investigation.findUnique({
    where: { id },
    include: {
      event: { include: { attempts: { orderBy: { attemptedAt: 'asc' } } } },
      messages: { orderBy: { seq: 'asc' } },
    },
  });
}

/** An investigation with its event (+attempts) and message thread, as `getInvestigationById` returns. */
export type InvestigationWithContext = NonNullable<
  Awaited<ReturnType<typeof getInvestigationById>>
>;
