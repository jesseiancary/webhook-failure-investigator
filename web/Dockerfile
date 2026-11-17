# syntax=docker/dockerfile:1
#
# Multi-stage build for the @wfi/web workspace. Build context is the REPO ROOT (the pnpm workspace
# install needs the root lockfile + every workspace manifest).
#
# Targets:
#   dev    — Vite dev server with HMR, used by docker-compose.
#   static — production static build served by nginx. STUB: finalized in Phase 10.

# --- deps: install the whole workspace once (cached on manifest + lockfile changes) ----------
FROM node:22-alpine AS deps
# server's postinstall runs `prisma generate` during the workspace install; its engine needs openssl.
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /app
# server's postinstall runs `prisma generate` (needs server/prisma); @wfi/contracts' `prepare`
# compiles its dist (needs the contracts source + its tsconfig + the shared base tsconfig). The
# contracts manifest must be present or the pnpm workspace glob skips it, leaving no symlink and
# breaking the web build's `@wfi/contracts` import resolution.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY server/prisma ./server/prisma
COPY contracts/package.json contracts/tsconfig.json ./contracts/
COPY contracts/src ./contracts/src
RUN pnpm install --frozen-lockfile

# --- dev: Vite dev server (source + node_modules come from the compose bind-mount/volumes) -----
# `--host 0.0.0.0` makes the server reachable from the host; the API proxy target and watch polling
# are supplied via env in docker-compose (WFI_API_PROXY_TARGET / WFI_WATCH_POLLING).
#
# NOTE: runs as root (standard for a dev container; keeps the WSL2 bind-mount writable). Vite only
# writes to the node_modules volume (its cache), so nothing root-owned lands in the mounted source.
# If you add a step that writes INTO /app, add a matching USER / `chown`.
FROM deps AS dev
ENV NODE_ENV=development
WORKDIR /app
COPY . .
EXPOSE 5173
CMD ["pnpm", "--filter", "@wfi/web", "dev", "--host", "0.0.0.0"]

# --- static: production build served by nginx -------------------------------------------------
# STUB for Phase 10 (ROADMAP §302 "production build for /web served by or alongside the API").
# The build stage is real so the target is exercisable now; the nginx config (SPA fallback, API
# reverse-proxy to the server, caching headers) is intentionally left minimal until Phase 10.
FROM deps AS web-build
WORKDIR /app
COPY . .
RUN pnpm --filter @wfi/web build

FROM nginx:alpine AS static
# Phase 10 TODO: add a tuned nginx.conf (history-API SPA fallback + /events,/investigations,/capture
# reverse-proxy to the server service). Default config serves the static bundle for now.
COPY --from=web-build /app/web/dist /usr/share/nginx/html
EXPOSE 80
