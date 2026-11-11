---
description: Run the Vitest suites across workspaces (or one workspace) and report failures
argument-hint: '[server|web]'
---

Run the Webhook Failure Investigator test suites.

**Guard:** If the toolchain isn't scaffolded yet (no root `package.json`), tell the user it arrives in roadmap Phase 2 — point them at `docs/ROADMAP.md` — and stop. Do not attempt to run tests.

Steps:

1. Scope by `$ARGUMENTS`:
   - `server` → `pnpm --filter @wfi/server test`
   - `web` → `pnpm --filter @wfi/web test`
   - empty → `pnpm -r test` (both workspaces).
2. Server integration tests (`*.int.test.ts`) need Postgres running. If they fail to connect, remind the user to start it (`docker compose up -d db`, with `POSTGRES_PORT=5433` for this project) and `pnpm --filter @wfi/server migrate` before retrying. Live OpenAI tests (`*.live.int.test.ts`) self-skip without `OPENAI_API_KEY` — that is expected, not a failure.
3. If everything passes, report succinctly (counts per workspace).
4. If anything fails, group failures by file, summarize the root cause, and propose the minimal fix. Do not auto-apply fixes unless asked.

Report the actual Vitest output — never claim a green suite without having run it.
