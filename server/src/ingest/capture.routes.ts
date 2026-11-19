import express from 'express';
import { asyncHandler } from '../http/error-handler.js';
import { captureLimiter } from '../http/rate-limit.js';
import { requireAdmin } from '../http/require-admin.js';
import {
  captureWebhook,
  createCaptureEndpoint,
  getCaptureEndpointByToken,
  listCaptureEndpoints,
  toHeaderMap,
} from './capture.service.js';
import { CaptureEndpointInputSchema } from './schemas.js';

export const captureRouter: express.Router = express.Router();

// POST /capture-endpoints — mint a capture endpoint; the token is returned here, once. Minting public
// ingest URLs is the one admin write, so it is bearer-token gated (requireAdmin); no-op when
// ADMIN_API_TOKEN is unset for local dev (Phase 10, B6).
captureRouter.post(
  '/capture-endpoints',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = CaptureEndpointInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'ValidationError', details: parsed.error.flatten() });
      return;
    }
    const endpoint = await createCaptureEndpoint(parsed.data);
    res.status(201).json(endpoint);
  }),
);

// GET /capture-endpoints — list minted endpoints (without their tokens).
captureRouter.get(
  '/capture-endpoints',
  asyncHandler(async (_req, res) => {
    res.json(await listCaptureEndpoints());
  }),
);

// POST /capture/:token — live ingest: record the inbound webhook against its endpoint. Public by
// design (the path token is the guard), rate-limited per IP so the open ingest can't be flooded (B5).
captureRouter.post(
  '/capture/:token',
  captureLimiter,
  asyncHandler(async (req, res) => {
    const endpoint = await getCaptureEndpointByToken(req.params.token);
    if (endpoint === null) {
      res.status(404).json({ error: 'NotFound' });
      return;
    }
    const event = await captureWebhook(endpoint, {
      // Strip the secret token out of the stored URL — it must never be persisted (core rule).
      url: req.originalUrl.replace(req.params.token, ':token'),
      headers: toHeaderMap(req.headers),
      body: req.body,
    });
    res.status(202).json({ id: event.id });
  }),
);
