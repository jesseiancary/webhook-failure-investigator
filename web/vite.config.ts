import { gzipSync } from 'node:zlib';
import process from 'node:process';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// The gzipped weight of the shared boot payload every route pays: the entry chunk plus everything it
// statically imports (the `vendor` chunk below). Lazy route/chat chunks are excluded — including the
// dashboard's, so this gate covers the framework+shell cost, NOT time-to-first-paint on `/` (a
// regression confined to one screen's lazy chunk won't trip it; that's by design — see PHASE_7_PLAN
// PR4). Measured ~111 kB gzip after splitting; budget has headroom for routine churn so only a real
// regression (e.g. a heavy dep pulled into the shared initial path) fails the build.
const INITIAL_LOAD_BUDGET_KB = 140;

/**
 * Fail the build if the initial-load JS exceeds the budget. Walks the static-import closure from each
 * entry chunk, gzips those chunks, and throws when the total crosses the limit — so bundle bloat
 * surfaces in CI (the `tooling` job, see docs/planned-ci.md) rather than silently shipping.
 */
function bundleBudget(budgetKb: number): Plugin {
  return {
    name: 'wfi-bundle-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = new Map(
        Object.values(bundle)
          .filter((output) => output.type === 'chunk')
          .map((chunk) => [chunk.fileName, chunk] as const),
      );

      // Transitive closure over *static* imports from the entry chunk(s).
      const initial = new Set<string>();
      const walk = (fileName: string): void => {
        if (initial.has(fileName)) return;
        initial.add(fileName);
        for (const imported of chunks.get(fileName)?.imports ?? []) walk(imported);
      };
      for (const chunk of chunks.values()) if (chunk.isEntry) walk(chunk.fileName);

      let gzipBytes = 0;
      for (const fileName of initial) {
        const chunk = chunks.get(fileName);
        if (chunk) gzipBytes += gzipSync(chunk.code).byteLength;
      }

      const gzipKb = gzipBytes / 1024;
      const summary = `${gzipKb.toFixed(1)} kB gzip across ${initial.size} initial chunk(s)`;
      if (gzipKb > budgetKb) {
        this.error(
          `Initial-load JS budget exceeded: ${summary} > ${budgetKb} kB. ` +
            `Lazy-load the regression or raise INITIAL_LOAD_BUDGET_KB in vite.config.ts deliberately.`,
        );
      }
      this.info(`Initial-load JS: ${summary} (budget ${budgetKb} kB).`);
    },
  };
}

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
  plugins: [react(), tailwindcss(), bundleBudget(INITIAL_LOAD_BUDGET_KB)],
  build: {
    // Raw per-chunk warning (the gzip budget above is the hard gate; this just flags large chunks).
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Split the stable framework deps into their own long-lived `vendor` chunk so it caches
        // across app deploys — they dominate the gzip weight, not our screen code.
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
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
