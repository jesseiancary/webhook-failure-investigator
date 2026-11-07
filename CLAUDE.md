# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**Webhook Failure Investigator** — an AI assistant that investigates failed webhook deliveries and explains what went wrong, grounded in the actual delivery logs.

Two goals drive every decision:
1. **Learn real-world LLM integration** (structured output, tool calling, context management, grounding, confidence handling).
2. **Serve as a portfolio piece for hiring managers** — it must be fully functioning and genuinely usable, not a demo stub.

Full rationale lives in [docs/PLAN.md](docs/PLAN.md); the phased build checklist is in [docs/ROADMAP.md](docs/ROADMAP.md). Read both before non-trivial work.

## The core rule

**Every LLM-produced claim must be grounded in log evidence.** The diagnosis must cite the real request/response/log fields it relied on. When evidence is insufficient, return `failureCategory: insufficient_evidence` with `isSpeculative: true` rather than inventing a cause. This rule is the whole point of the project — never regress it.

## Intended layout

> The repo is mid-build. This is the **target** structure; the monorepo scaffold lands in **Phase 2** of the roadmap.

```
/server        Express + TypeScript API, Prisma, OpenAI integration
/web           React + TypeScript + Vite frontend
/docs          PLAN.md, ROADMAP.md, eval scorecards
/.claude       Claude Code developer tooling (this phase)
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
- **Failure taxonomy (enum):** `authentication`, `payload_validation`, `timeout`, `network_failure`, `rate_limit`, `server_error`, `application_logic`, `insufficient_evidence`.

## Commands

> These become runnable in **Phase 2** once the monorepo + toolchain exist. Until then they are the intended interface.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Dev (all) | `pnpm dev` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Test | `pnpm test` |
| Migrate (dev) | `pnpm --filter server prisma migrate dev` |
| Seed scenarios | `pnpm --filter server db:seed` |
| Run evals | `pnpm eval` |

## Working agreements

- **Never create branches, commit, or open PRs** — the user handles all git mutations manually. Read-only git is fine. Use `/pr` to produce a copy-pasteable PR title/description.
- Build in the roadmap's phase order; keep each phase a shippable increment.
- Available slash commands (`/seed-scenario`, `/eval`, `/migrate`, `/typecheck`, `/pr`) and subagents (`prompt-evaluator`, `pr-reviewer`) live under `.claude/`.
