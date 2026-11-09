import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { getEventById } from '../ingest/events.service.js';
import type { Diagnosis } from './diagnosis.schema.js';
import { createOpenAIDiagnosisClient, type DiagnosisClient } from './openai.js';
import { computeCostUsd } from './pricing.js';
import {
  FEW_SHOT_MESSAGES,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserMessage,
  type ChatMessage,
} from './prompt.js';

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
 * Investigate one stored event and persist the resulting Investigation. Returns `null` when the
 * event does not exist (the route maps that to a 404); otherwise returns the created row.
 */
export async function investigateEvent(eventId: string, opts?: { client?: DiagnosisClient }) {
  const event = await getEventById(eventId);
  if (event === null) {
    return null;
  }

  // System prompt + the curated few-shot turns + the serialized event under investigation. The
  // event row from `getEventById` satisfies `SerializableEvent` structurally (that's why the type is
  // loose), so it feeds the same serializer the few-shots were built with.
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...FEW_SHOT_MESSAGES,
    { role: 'user', content: buildUserMessage(event) },
  ];

  const client = opts?.client ?? createOpenAIDiagnosisClient();
  const { diagnosis, usage, model } = await client.runDiagnosis(messages);

  const costUsd = computeCostUsd(model, usage.promptTokens, usage.completionTokens);

  // Persist the full diagnosis as Json and hoist the queryable fields to columns. `promptVersion`
  // records which prompt produced it; `model`/token/cost fields are the accounting the CLAUDE.md
  // rule requires on every LLM-produced Investigation.
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
    },
  });
}
