import { prisma } from '../db/client.js';
import { assembleChatMessages } from './chat.context.js';
import { createOpenAIChatClient, type ChatClient, type ChatUsage } from './chat.client.js';
import { DiagnosisSchema } from './diagnosis.schema.js';
import { getInvestigationById } from './diagnosis.service.js';
import { computeCostUsd } from './pricing.js';

// The orchestration for one follow-up chat turn: load the investigation's grounding context, persist
// the question, stream a grounded answer, and persist that answer with its accounting. The streaming
// twin of investigateEvent — where that returns one Investigation, this yields a live event stream the
// SSE route forwards. The `client` seam lets tests inject a scripted fake; production streams OpenAI.

/**
 * One event the chat route forwards to the client. `delta` carries the next text chunk verbatim; the
 * terminal `done` carries the persisted answer's id plus the model/usage/cost for the final SSE event.
 */
export type ChatTurnEvent =
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      messageId: string;
      model: string;
      usage: ChatUsage;
      /** The turn's cost as a decimal string (matches the Decimal(10,6) column's serialization). */
      costUsd: string;
    };

/**
 * Stream one follow-up chat turn for an investigation. Returns `null` when the investigation doesn't
 * exist (the route maps that to a 404 BEFORE opening the SSE stream, so the error stays ordinary
 * JSON). Otherwise returns an async generator that, when consumed:
 *
 * 1. persists the `user` question row (first, so its `seq` precedes the answer);
 * 2. assembles the grounded context from the prior diagnosis + delivery logs + prior chat turns
 *    (re-parsing the stored diagnosis Json via DiagnosisSchema — chat.context intentionally takes a
 *    parsed `Diagnosis`, and the value was validated at write time so this re-parse is safe);
 * 3. streams the answer, yielding each delta;
 * 4. persists the `assistant` answer row with per-turn accounting (model, tokens, cost — CLAUDE.md
 *    rule) and yields a terminal `done` carrying that row's id and accounting.
 *
 * The read happens up front (outside the generator) so the 404 decision is made before any streaming
 * begins; persistence and streaming happen as the generator is consumed.
 */
export async function streamChatTurn(
  investigationId: string,
  userText: string,
  opts?: { client?: ChatClient },
): Promise<AsyncGenerator<ChatTurnEvent> | null> {
  const investigation = await getInvestigationById(investigationId);
  if (investigation === null) {
    return null;
  }

  // Re-parse the stored diagnosis Json into the typed Diagnosis chat.context expects. It was validated
  // by DiagnosisSchema.parse at write time, so this is a safe, cheap re-validation at the boundary.
  const diagnosis = DiagnosisSchema.parse(investigation.diagnosis);
  const { event, messages } = investigation;
  const client = opts?.client ?? createOpenAIChatClient();

  return (async function* (): AsyncGenerator<ChatTurnEvent> {
    // Persist the question first so its seq orders before the answer in the replayed thread.
    await prisma.investigationMessage.create({
      data: { investigationId, role: 'user', content: userText },
    });

    const assembled = assembleChatMessages({
      diagnosis,
      event,
      history: messages,
      userMessage: userText,
    });

    // The assistant row is persisted only AFTER the stream completes below, so an interrupted turn —
    // a client disconnect (the route breaks this loop) or a mid-stream failure — discards the partial
    // answer: the question row stays, but no truncated answer is stored as if it were complete.
    let answer = '';
    let model = '';
    let usage: ChatUsage = { promptTokens: 0, completionTokens: 0 };
    for await (const streamEvent of client.streamChat(assembled)) {
      if (streamEvent.type === 'delta') {
        answer += streamEvent.text;
        yield { type: 'delta', text: streamEvent.text };
      } else {
        // The terminal event carries the authoritative accumulated content, model, and usage.
        answer = streamEvent.content;
        model = streamEvent.model;
        usage = streamEvent.usage;
      }
    }

    const costUsd = computeCostUsd(model, usage.promptTokens, usage.completionTokens);
    const assistant = await prisma.investigationMessage.create({
      data: {
        investigationId,
        role: 'assistant',
        content: answer,
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        costUsd,
      },
    });

    yield { type: 'done', messageId: assistant.id, model, usage, costUsd: costUsd.toString() };
  })();
}
