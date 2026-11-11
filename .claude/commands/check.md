---
description: Run the full local CI-parity gate (typecheck, lint, format, test, build) and report what would pass or fail CI
---

Run the same checks the CI `quality` job runs (`.github/workflows/ci.yml`), locally, so the user knows whether CI will be green **before** committing.

**Guard:** If the toolchain isn't scaffolded yet (no root `package.json`), tell the user it arrives in roadmap Phase 2 — point them at `docs/ROADMAP.md` — and stop.

Run **all** of these, in order, and do **not** stop at the first failure (the user wants the full picture):

1. `pnpm typecheck` — `tsc -b --noEmit` across `/server` and `/web`.
2. `pnpm lint` — ESLint.
3. `pnpm format:check` — Prettier (report only; do not auto-format here).
4. `pnpm -r test` — Vitest in both workspaces. Note: server integration tests need Postgres up (`docker compose up -d db`, `POSTGRES_PORT=5433`); live OpenAI tests self-skip without a key.
5. `pnpm build` — the workspace builds.

Then present a compact pass/fail table (one row per step: ✅/❌ + a one-line summary). For each failing step, group the errors and propose the minimal fix, but do not auto-apply unless asked. End with a one-line verdict: **CI would pass** / **CI would fail** (and which gate).

Report the real command output — never mark a step green without having run it. This command only reads and runs checks; it performs no git mutation.
