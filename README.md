# Webhook Failure Investigator

An AI assistant that investigates failed webhook deliveries and explains what went wrong — **grounded in the actual delivery logs, not guesses**. It classifies the failure, explains the root cause while citing the real request/response/log fields it relied on, and recommends concrete fixes. When the evidence is too thin, it returns `insufficient_evidence` rather than inventing a cause.

See [docs/PLAN.md](docs/PLAN.md) for the full engineering plan and [docs/ROADMAP.md](docs/ROADMAP.md) for the phased build status.

> **Status:** mid-build. The monorepo, toolchain, and CI are in place (Phase 2); the data model, diagnosis engine, and UI land in later phases.

## Prerequisites

- **Node 22** (see [.nvmrc](.nvmrc)) — `nvm use`
- **pnpm 9** — `corepack enable`
- **Docker** (for local Postgres)

## Quickstart

```bash
pnpm install            # install workspace dependencies
cp .env.example .env    # local dev defaults (edit as needed)
docker compose up -d    # start Postgres
pnpm dev                # run server + web on the host
```

- Web: http://localhost:5173
- Server health check: http://localhost:3000/health

Stop Postgres with `docker compose down` (add `-v` to also drop the data volume).

> If host port 5432 is already in use, set `POSTGRES_PORT` in `.env` (and update `DATABASE_URL` to match).

> Database migrations and seed data (`pnpm --filter @wfi/server prisma migrate dev`, `db:seed`) arrive in Phase 3.

## Commands

| Task      | Command          |
| --------- | ---------------- |
| Install   | `pnpm install`   |
| Dev (all) | `pnpm dev`       |
| Typecheck | `pnpm typecheck` |
| Lint      | `pnpm lint`      |
| Format    | `pnpm format`    |
| Test      | `pnpm test`      |
| Build     | `pnpm build`     |

## Layout

```
/server    Express + TypeScript API (Prisma + OpenAI integration land in later phases)
/web       React + TypeScript + Vite frontend
/docs      PLAN.md, ROADMAP.md, planned-ci.md
/.claude   Claude Code developer tooling
```
