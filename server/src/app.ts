import express, { type Express } from 'express';
import { errorHandler } from './http/error-handler.js';
import { captureRouter } from './ingest/capture.routes.js';
import { eventsRouter } from './ingest/events.routes.js';

export const app: Express = express();

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(eventsRouter);
app.use(captureRouter);

// Terminal error middleware — must be registered last.
app.use(errorHandler);
