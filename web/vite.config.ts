import process from 'node:process';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The server runs on PORT (default 3000; see server/src/config/env.ts). We proxy the API routes to
// it in dev so the browser only ever talks to the Vite origin — no CORS middleware on the server
// (that's a Phase 10 hardening concern). Keep this list in sync with the mounted routers in
// server/src/app.ts: /events, /investigations, /capture(+/-endpoints), /health.
const API_TARGET = `http://localhost:${process.env.PORT ?? 3000}`;
const API_ROUTES = ['/events', '/investigations', '/capture', '/health'];

// Some client routes share a path with an API route (e.g. the `/events/:id` detail page vs. the
// `GET /events/:id` endpoint). A browser *navigation* (Accept: text/html) to such a path must serve
// the SPA, not proxy to the API — otherwise a hard reload or pasted deep link renders raw JSON.
// `fetch`/XHR send `Accept: */*`, so apiClient calls still proxy through untouched.
function spaNavigationBypass(req: {
  method?: string;
  headers: { accept?: string };
}): string | void {
  if (req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')) {
    return '/index.html';
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Pinned so the proxy target, docs, and the Phase 7 e2e all agree on one dev URL.
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      API_ROUTES.map((route) => [
        route,
        { target: API_TARGET, changeOrigin: true, bypass: spaNavigationBypass },
      ]),
    ),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
