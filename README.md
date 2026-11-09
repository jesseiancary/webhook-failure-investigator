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

> Set up the database, then load the scenario library:
>
> ```sh
> pnpm --filter @wfi/server prisma migrate dev   # create/apply the schema
> pnpm --filter @wfi/server db:seed              # load 11 labeled failure scenarios (idempotent)
> ```
>
> Seeded events use stable `seed_*` ids (e.g. `GET /events/seed_stripe_auth_401`); re-running `db:seed` refreshes them without touching live-captured events.

> Investigate a stored event (requires `OPENAI_API_KEY` in `.env` — this makes a real, billed model call):
>
> ```sh
> curl -XPOST localhost:3000/events/seed_stripe_auth_401/investigate   # → 201 with a grounded diagnosis
> curl localhost:3000/events/seed_stripe_auth_401/investigations        # prior runs, newest-first
> ```

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
