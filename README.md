# Webhook Failure Investigator

An AI assistant that investigates failed webhook deliveries and explains what went wrong — **grounded in the actual delivery logs, not guesses**. It classifies the failure, explains the root cause while citing the real request/response/log fields it relied on, and recommends concrete fixes. When the evidence is too thin, it returns `insufficient_evidence` rather than inventing a cause.

See [docs/PLAN.md](docs/PLAN.md) for the full engineering plan and [docs/ROADMAP.md](docs/ROADMAP.md) for the phased build status.

> **Status:** mid-build. The monorepo, toolchain, and CI are in place (Phase 2); the data model, diagnosis engine, and UI land in later phases.

## Prerequisites

**Docker-only** — enough to run and develop the app:

- **Docker** (with the Compose v2 plugin) — `docker compose up` builds and runs postgres + server + web; migrates + seeds on first boot, hot-reloads your edits, and works with no `.env` (fake-LLM mode).

**Host dev loop (optional, faster inner loop)** — adds, on top of Docker:

- **Node 22** (see [.nvmrc](.nvmrc)) — `nvm use`
- **pnpm 9** — `corepack enable`

Run the app on the host via `pnpm dev` with only Postgres containerized. This is the faster edit loop and is required for the `pnpm` convenience scripts; see [Quickstart](#quickstart) for both paths.

## Quickstart

Two supported workflows — the full stack in Docker, or the fast host loop with only Postgres in a
container.

### Full stack in Docker (one command)

```bash
cp .env.example .env    # local dev defaults (edit as needed)
docker compose up       # postgres + server + web; migrates + seeds on first boot
```

- Web: http://localhost:5173
- Server health check: http://localhost:3000/health

By default the stack runs with `WFI_FAKE_LLM=1` — a deterministic fake LLM, so it comes up with no
OpenAI key and no spend. For live diagnosis, set a real `OPENAI_API_KEY` in `.env` and `WFI_FAKE_LLM=0`.

Tear down with `docker compose down` (add `-v` to also drop the Postgres data + `node_modules` volumes).

> **Changed a dependency?** The container's `node_modules` live in named volumes that Docker only
> populates on first creation, so `docker compose up --build` alone won't pick up a new/upgraded
> package — the containers keep the stale volume. After editing `package.json`/`pnpm-lock.yaml`,
> refresh the volumes first:
>
> ```bash
> docker compose down                     # or: docker compose stop
> docker volume rm webhook-failure-investigator_wfi_root_node_modules \
>   webhook-failure-investigator_wfi_server_node_modules \
>   webhook-failure-investigator_wfi_web_node_modules   # keeps wfi_pgdata (your DB data)
> docker compose up --build
> ```
>
> `docker compose down -v` does the same but also drops `wfi_pgdata` (your captured events + investigations).

### Host dev loop (Postgres-only container)

Fastest edit loop — run the app on the host and containerize only the database:

```bash
pnpm install                 # install workspace dependencies
cp .env.example .env         # local dev defaults (edit as needed)
docker compose up -d postgres  # start ONLY Postgres
pnpm dev                     # run server + web on the host
```

Same URLs as above. Here the app reaches Postgres on `localhost` (the `DATABASE_URL` in `.env`); in
the full-stack container it reaches it on `postgres:5432` (set by `docker-compose.yml`).

> If host port 5432 is already in use, set `POSTGRES_PORT` in `.env` (and update `DATABASE_URL` to match).

> Set up the database, then load the scenario library (host-dev path only — the full-stack container
> migrates + seeds automatically on first boot):
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

### Common tasks (Docker + DB)

Convenience scripts that front the multi-step container/database sequences:

| Task                              | Command               | What it does                                                                                                 |
| --------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Full stack (containers)           | `pnpm docker:up`      | `docker compose up --build` — postgres + server + web; migrates + seeds on first boot.                       |
| Postgres only (host-dev loop)     | `pnpm docker:db`      | `docker compose up -d postgres`, then run `pnpm dev` on the host.                                            |
| Refresh after a dependency change | `pnpm docker:refresh` | Tears down and drops the `node_modules` volumes (keeps `wfi_pgdata`) before rebuilding — see the note below. |
| Reset the DB schema + seed (host) | `pnpm db:reset`       | `prisma migrate deploy` + idempotent `db:seed` against the host-reachable Postgres.                          |

> **Why `docker:refresh`?** The container's `node_modules` live in named volumes that Docker only
> populates on first creation, so `docker compose up --build` alone won't pick up a new/upgraded
> package. Run `pnpm docker:refresh` after editing `package.json`/`pnpm-lock.yaml`. It preserves your
> Postgres data; `docker compose down -v` would also wipe that.

### Don't source `.env` into your shell

The app loads `.env` itself (via dotenv in `server/src/config/env.ts`), and `docker compose` reads it
directly — nothing you run by hand needs those vars exported. **Do not** `set -a; . ./.env` or
`export` its contents into your interactive shell: dotenv never overrides a variable already present
in the environment, so a stale export silently wins over the file. Two ways this bites:

- A leftover `DATABASE_URL` makes the app ignore the port in `.env` and connect to the wrong Postgres.
- A leftover **`NODE_ENV=development` makes `pnpm build` produce a development bundle** (React & friends
  ship larger dev builds), which fails the web bundle-budget gate with a confusing "Initial-load JS
  budget exceeded" error.

If a build or DB connection behaves unexpectedly, check the shell is clean and clear any leftovers:

```bash
env | grep -E 'NODE_ENV|DATABASE_URL|POSTGRES'   # expect no output for host dev
unset NODE_ENV DATABASE_URL                       # or just open a fresh terminal
```

## Layout

```
/server    Express + TypeScript API (Prisma + OpenAI integration land in later phases)
/web       React + TypeScript + Vite frontend
/docs      PLAN.md, ROADMAP.md, planned-ci.md
/.claude   Claude Code developer tooling
```
