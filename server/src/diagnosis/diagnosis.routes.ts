import express from 'express';
import { asyncHandler } from '../http/error-handler.js';
import { investigateEvent, listInvestigations } from './diagnosis.service.js';

export const diagnosisRouter: express.Router = express.Router();

// POST /events/:id/investigate — run the diagnosis engine over a stored event and persist the
// result. `investigateEvent` returns null when the event doesn't exist (mapped to 404 here) so the
// 404 vs 201 decision lives in one place. A real OpenAI call happens on the default path, so this
// route needs OPENAI_API_KEY; tests inject a stub via the service's `client` seam.
diagnosisRouter.post(
  '/events/:id/investigate',
  asyncHandler(async (req, res) => {
    const investigation = await investigateEvent(req.params.id);
    if (investigation === null) {
      res.status(404).json({ error: 'NotFound' });
      return;
    }
    res.status(201).json(investigation);
  }),
);

// GET /events/:id/investigations — prior runs for an event, newest-first (Phase 7 history view).
// Unknown event → 404 (mirrors GET /events/:id); an existing event with no runs → `[]`.
diagnosisRouter.get(
  '/events/:id/investigations',
  asyncHandler(async (req, res) => {
    const investigations = await listInvestigations(req.params.id);
    if (investigations === null) {
      res.status(404).json({ error: 'NotFound' });
      return;
    }
    res.json(investigations);
  }),
);
