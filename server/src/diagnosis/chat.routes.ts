import express from 'express';
import { asyncHandler } from '../http/error-handler.js';
import { openSSE } from '../http/sse.js';
import { ChatRequestSchema } from './chat.schema.js';
import { streamChatTurn } from './chat.service.js';

export const chatRouter: express.Router = express.Router();

// POST /investigations/:id/chat — stream a grounded answer to a follow-up question about one
// investigation over SSE. The 4xx preconditions are resolved as ordinary JSON responses BEFORE the
// stream opens: an invalid body is a 400, an unknown investigation a 404 (streamChatTurn returns null).
// Only once both pass do we switch the response to an event stream — because flushing the 200 +
// event-stream headers commits the status, after which a 404/400 can no longer be sent.
chatRouter.post(
  '/investigations/:id/chat',
  asyncHandler(async (req, res) => {
    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'BadRequest' });
      return;
    }

    const stream = await streamChatTurn(req.params.id, parsed.data.message);
    if (stream === null) {
      res.status(404).json({ error: 'NotFound' });
      return;
    }

    const sse = openSSE(res);
    // A client disconnect sets the flag; the loop breaks at the next boundary, which runs the
    // generator's cleanup (stopping the upstream OpenAI stream) instead of streaming into a dead socket.
    let clientGone = false;
    req.on('close', () => {
      clientGone = true;
    });

    try {
      for await (const event of stream) {
        if (clientGone) {
          break;
        }
        if (event.type === 'delta') {
          sse.sendEvent('delta', { text: event.text });
        } else {
          sse.sendEvent('done', {
            investigationId: req.params.id,
            messageId: event.messageId,
            model: event.model,
            usage: event.usage,
            costUsd: event.costUsd,
          });
        }
      }
    } catch (err) {
      // The stream headers are already committed, so a mid-stream failure can't become a 500 — but it
      // must still be logged server-side (every other fault is; see http/error-handler.ts), not only
      // surfaced to the client. Report an opaque terminal `error` event — no internal detail leaks.
      console.error(err);
      if (!clientGone) {
        sse.sendEvent('error', { error: 'ChatStreamFailed' });
      }
    } finally {
      sse.close();
    }
  }),
);
