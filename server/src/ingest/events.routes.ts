import express from 'express';
import { asyncHandler } from '../http/error-handler.js';
import { createEvent, getEventById, listEvents } from './events.service.js';
import { ManualSubmissionSchema } from './schemas.js';

export const eventsRouter: express.Router = express.Router();

// POST /events — manual submission: validate -> redact (in the service) -> persist.
eventsRouter.post(
  '/events',
  asyncHandler(async (req, res) => {
    const parsed = ManualSubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
      return;
    }
    const event = await createEvent(parsed.data);
    res.status(201).json(event);
  }),
);

// GET /events — newest-first summary list.
eventsRouter.get(
  '/events',
  asyncHandler(async (_req, res) => {
    res.json(await listEvents());
  }),
);

// GET /events/:id — one event with its delivery attempts, or 404.
eventsRouter.get(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const event = await getEventById(req.params.id);
    if (event === null) {
      res.status(404).json({ error: 'NotFound' });
      return;
    }
    res.json(event);
  }),
);
