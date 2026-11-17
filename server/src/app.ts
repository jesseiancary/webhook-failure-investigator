import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { env } from './config/env.js';
import { chatRouter } from './diagnosis/chat.routes.js';
import { diagnosisRouter } from './diagnosis/diagnosis.routes.js';
import { errorHandler } from './http/error-handler.js';
import { captureRouter } from './ingest/capture.routes.js';
import { eventsRouter } from './ingest/events.routes.js';

export const app: Express = express();

app.use(express.json({ limit: '1mb' }));

// Registered before the web layer so /health always returns JSON (it is the deploy healthcheck target),
// never the SPA shell, regardless of the request's Accept header.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// In production (single-origin deploy) the server also serves the compiled web bundle. This MUST be
// mounted before the API routers: a browser navigation to a client route that shares a path with an API
// route (e.g. /events/:id) has to serve the SPA shell, not the API's JSON. No-op in dev (Vite serves
// the web app) and if the bundle is absent (an API-only image still boots).
mountWebIfPresent();

app.use(eventsRouter);
app.use(captureRouter);
app.use(diagnosisRouter);
app.use(chatRouter);

// Terminal error middleware — must be registered last.
app.use(errorHandler);

/**
 * Serve the built web bundle on the same origin as the API (Phase 10 single-service deploy — no
 * separate web host, no CORS). Gated to production, or to an explicit `WEB_DIST_PATH` (for a local
 * prod-parity smoke); and skipped if the bundle isn't present, so an API-only image still answers
 * `/health`.
 */
function mountWebIfPresent(): void {
  if (env.NODE_ENV !== 'production' && env.WEB_DIST_PATH === undefined) {
    return;
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  // Default: web/dist sits next to server/dist in the runtime image (/app/web/dist); from the compiled
  // dist/app.js that is ../../web/dist. Overridable via WEB_DIST_PATH.
  const webDist = env.WEB_DIST_PATH ?? path.resolve(here, '../../web/dist');
  const indexHtml = path.join(webDist, 'index.html');

  if (!fs.existsSync(indexHtml)) {
    console.warn(`[web] static bundle not found at ${webDist}; serving API only.`);
    return;
  }

  // Hashed, immutable build assets served as files. index:false so the navigation bypass below owns "/".
  app.use(express.static(webDist, { index: false }));

  // SPA navigation bypass — mirrors `spaNavigationBypass` in web/vite.config.ts. A browser *navigation*
  // (GET + Accept: text/html) to any path serves the SPA shell, so a pasted deep link or hard reload to
  // a client route that shares a path with an API route (e.g. /events/:id) renders the app instead of
  // raw JSON. apiClient's fetch/XHR calls send Accept: */*, so they fall through to the API routers
  // untouched. Real build assets are already handled by express.static above.
  app.get('*', (req, res, next) => {
    if ((req.headers.accept ?? '').includes('text/html')) {
      res.sendFile(indexHtml);
      return;
    }
    next();
  });
}
