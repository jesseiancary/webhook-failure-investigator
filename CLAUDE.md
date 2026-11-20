# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**Webhook Failure Investigator** — an AI assistant that investigates failed webhook deliveries and explains what went wrong, grounded in the actual delivery logs.

Two goals drive every decision:

1. **Learn real-world LLM integration** (structured output, tool calling, context management, grounding, confidence handling).
2. **Serve as a portfolio piece for hiring managers** — it must be fully functioning and genuinely usable, not a demo stub.

Full rationale lives in [docs/PLAN.md](docs/PLAN.md); the phased build checklist is in [docs/ROADMAP.md](docs/ROADMAP.md). Read both before non-trivial work.

## Current phase

**Phases 1–10 complete.** The app is a working, fully containerized full stack, now deployed live on Railway: data model + ingestion, grounded structured-output diagnosis, tool calling, follow-up chat, the React UI, an eval harness, `docker compose up` for the whole stack with in-container hot reload (the host `pnpm dev` loop is still supported), and — as of **Phase 10 (Deploy & Hardening)** — a single-service Railway deploy with managed Postgres, migrations-on-deploy, a prod web build served on one origin, tiered per-IP rate limiting, a constant-time admin bearer gate on writes, and a DB-backed daily OpenAI cost cap; the live smoke test (seeded investigation + follow-up) and the no-secrets-in-records/logs check both pass. **Next: Phase 11 — Portfolio Presentation** (README architecture diagram, demo GIF, "engineering decisions" writeup, embedded eval scorecard). [docs/ROADMAP.md](docs/ROADMAP.md) is the authoritative checklist.

## The core rule

**Every LLM-produced claim must be grounded in log evidence.** The diagnosis must cite the real request/response/log fields it relied on. When evidence is insufficient, return `failureCategory: insufficient_evidence` with `isSpeculative: true` rather than inventing a cause. This rule is the whole point of the project — never regress it.

## Layout

> The `/server` and `/web` workspaces are fully built out — Prisma data model, OpenAI integration (structured output + tool calling), follow-up chat, and the React UI — and the whole stack is containerized (**Phase 9**). The skeletons landed in Phase 2 (PR1) and filled in over Phases 3–9; see [docs/ROADMAP.md](docs/ROADMAP.md) for the history.

```
/server        Express + TypeScript API, Prisma, OpenAI integration
/web           React + TypeScript + Vite frontend
/docs          PLAN.md, ROADMAP.md, eval scorecards
/.claude       Claude Code developer tooling
```

## Tech stack

- **Backend:** Node.js + TypeScript + Express; PostgreSQL via **Prisma**; **Zod** (one schema set drives both API validation and LLM structured output); **OpenAI SDK** (Structured Outputs + tool calling); **pino** logging + per-call token/cost accounting.
- **Frontend:** React + TypeScript + **Vite**, **TailwindCSS** + **shadcn/ui**, **TanStack Query**, React Router, SSE streaming chat.
- **Testing:** Vitest (unit) + Supertest (API) + one Playwright e2e; an LLM eval harness.
- **Ops:** Docker Compose (app + Postgres), GitHub Actions CI, Railway/Render deploy.

## Conventions

- **Language:** TypeScript everywhere; prefer explicit types at module boundaries.
- **Validation:** define Zod schemas once and share them between API input validation and OpenAI structured-output contracts. Do not duplicate shapes.
- **Secrets:** redact auth headers and tokens **before** persisting or logging a delivery attempt. Never store or log raw credentials.
- **LLM calls:** always record `model`, `promptTokens`, `completionTokens`, and `costUsd` on the resulting `Investigation`.
- **Naming:** `camelCase` for variables/functions, `PascalCase` for types and Prisma models, `kebab-case` for file names, `SCREAMING_SNAKE_CASE` for env vars.
- **Page width:** the app shell (`web/src/components/app-shell/app-shell.tsx`) owns page width — its `<main>` and header share one `mx-auto max-w-*` container so every view lines up. Route components render into that outlet and must **not** add their own `mx-auto`/`max-w-*` page wrapper (use a plain `space-y-*` wrapper). To change the width, change it there, in one place.
- **Failure taxonomy (enum):** `authentication`, `payload_validation`, `timeout`, `network_failure`, `rate_limit`, `server_error`, `application_logic`, `insufficient_evidence`.
- **Never source `.env` into the shell.** The app loads it via dotenv (`server/src/config/env.ts`) and `docker compose` reads it directly — nothing run by hand needs those vars exported. dotenv won't override an already-set variable, so a stale `set -a; . ./.env` / `export` silently wins over the file: a leftover `DATABASE_URL` connects to the wrong Postgres, and a leftover `NODE_ENV=development` makes `pnpm build` emit a dev bundle that fails the web bundle-budget gate. If a build or DB connection misbehaves, check `env | grep -E 'NODE_ENV|DATABASE_URL|POSTGRES'` is empty for host dev and `unset` any leftovers.

## Commands

> Runnable as of **Phase 2 (PR1)**. Commands whose underlying feature arrives later (`migrate`, `db:seed`, `eval`) no-op gracefully until that phase lands.

| Task           | Command                                   |
| -------------- | ----------------------------------------- |
| Install        | `pnpm install`                            |
| Dev (all)      | `pnpm dev`                                |
| Typecheck      | `pnpm typecheck`                          |
| Lint           | `pnpm lint`                               |
| Test           | `pnpm test`                               |
| Migrate (dev)  | `pnpm --filter server prisma migrate dev` |
| Seed scenarios | `pnpm --filter server db:seed`            |
| Run evals      | `pnpm eval`                               |

## Working agreements

- **Never create branches, commit, or open PRs** — the user handles all git mutations manually. Read-only git is fine. Use `/pr` to produce a copy-pasteable PR title/description.
- Build in the roadmap's phase order; keep each phase a shippable increment.
- Available slash commands (`/seed-scenario`, `/eval`, `/migrate`, `/typecheck`, `/pr`) and subagents (`prompt-evaluator`, `pr-reviewer`) live under `.claude/`.
