// The server API paths the Vite dev server proxies to the backend in dev (see web/vite.config.ts),
// so the browser only ever talks to the Vite origin and the server needs no CORS middleware (a
// Phase 10 concern). Keep this list in sync with the routers mounted in server/src/app.ts:
//   /events + /events/:id/investigate   (eventsRouter, diagnosisRouter)
//   /investigations/:id                 (diagnosisRouter, chatRouter)
//   /capture/:token + /capture-endpoints (captureRouter)
//   /health
//
// `/capture-endpoints` is listed separately from `/capture` on purpose: the keys are matched as
// anchored path segments (see apiProxyKey), and `^/capture([/?]|$)` does NOT match
// `/capture-endpoints` (the next char is `-`, not `/`, `?`, or end-of-string). Without its own entry
// that real route would stop being proxied.
export const API_ROUTES = [
  '/events',
  '/investigations',
  '/capture',
  '/capture-endpoints',
  '/health',
] as const;

/**
 * The Vite dev-proxy key for an API route: an anchored RegExp source matching the route exactly, any
 * sub-path (`/events`, `/events/:id`), or the route with a query string (`/events?limit=10`) — but
 * NOT a prefix-sharing sibling (`/events-archive`). Vite treats a proxy key beginning with `^` as a
 * RegExp and tests it against `req.url`, which carries the query string (`doesProxyContextMatchUrl`
 * in Vite's dev server), so the boundary must admit `?` as well as `/` and end-of-string — otherwise
 * a `?`-bearing request falls through to the SPA instead of proxying.
 */
export function apiProxyKey(route: string): string {
  return `^${route}([/?]|$)`;
}

/**
 * Whether `path` would be proxied to the API by any configured route. Introspection/test helper that
 * mirrors how Vite matches the generated proxy keys.
 */
export function isProxiedApiPath(path: string): boolean {
  return API_ROUTES.some((route) => new RegExp(apiProxyKey(route)).test(path));
}
