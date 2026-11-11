---
name: deploy
description: Containerize the stack (Phase 9) and deploy a hardened live instance to Railway/Render (Phase 10) — Dockerfiles, compose orchestration, migrations on deploy, secret/redaction and cost guardrails. Use when building Phase 9 or 10.
---

# Containerize & deploy

Take the stack from "runs on host via `pnpm dev`" to a live, reasonably secure URL.

> This spans **Phase 9** (containerization) and **Phase 10** (deploy & hardening) in `docs/ROADMAP.md`. Containerization was deliberately deferred so the prompt/UI work could iterate on a fast host loop — don't start until that work is stable. Do the phase that's current; defer the rest.

## Phase 9 — Full local containerization

- **Images:** `server/Dockerfile` as multi-stage (deps → build → slim `node:22-alpine` runtime, non-root user, boots `dist/index.js`); `web/Dockerfile` with a Vite dev target now and a stubbed static/nginx prod target for Phase 10. Add per-workspace `.dockerignore` (exclude `node_modules`, `dist`, `.env`, coverage).
- **Compose:** add `server` + `web` services to `docker-compose.yml` networked to `postgres`; gate app startup on `depends_on: postgres: { condition: service_healthy }`; use the container-network `DATABASE_URL` (host `postgres`, not `localhost`).
- **Keep the fast path:** preserve host `pnpm dev` (compose profile or `docker-compose.override.yml`) and in-container hot reload (bind-mount source + named `node_modules` volume; enable watch polling for WSL2).
- **Verify:** `docker compose up` brings up postgres + server + web; `curl localhost:3000/health` returns ok from the container; a seeded investigation runs end to end in-container; editing a `.ts/.tsx` hot-reloads; `docker compose down -v` cleans up and host `pnpm dev` still works.

## Phase 10 — Deploy & hardening

- **Deploy:** provision Railway/Render + managed Postgres; configure env/secrets; **run migrations on deploy** (`prisma migrate deploy`); serve the `/web` production build by or alongside the API.
- **Hardening gates (enforce the project invariants in prod):**
  - Re-verify secret/header **redaction** in both storage _and_ logs (`server/src/ingest/redact.ts`) — the core rule.
  - Rate-limit public endpoints; add a lightweight auth gate on write endpoints.
  - Set OpenAI **cost guardrails** — per-request and daily caps — consistent with the per-`Investigation` token/cost accounting the app already records.
- **Verify:** a deployed smoke test runs one seeded investigation + one follow-up on the live URL; confirm no secrets appear in stored records or logs.

## Checklist

- [ ] (P9) Server + web Dockerfiles, `.dockerignore`, compose services, DB-health gating
- [ ] (P9) Host `pnpm dev` + in-container hot reload both still work
- [ ] (P10) Managed Postgres + migrations-on-deploy + prod web build
- [ ] (P10) Redaction re-verified in storage & logs; rate limit + auth on writes
- [ ] (P10) OpenAI per-request + daily cost caps
- [ ] Live smoke test green; no secrets in records or logs
