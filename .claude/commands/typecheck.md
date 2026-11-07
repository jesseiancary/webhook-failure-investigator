---
description: Typecheck all workspaces and report any TypeScript errors
---

Typecheck the Webhook Failure Investigator workspaces.

**Guard:** If the toolchain isn't scaffolded yet (no root `package.json` or no `tsconfig.json`), tell the user the toolchain isn't set up yet — it arrives in roadmap Phase 2 — point them at `docs/ROADMAP.md`, and stop. Do not attempt to run `tsc`.

Steps:
1. Run the project typecheck (`pnpm typecheck`, which runs `tsc --noEmit` across `/server` and `/web`).
2. If it passes, report success succinctly.
3. If it fails, group the errors by file, summarize the root causes, and propose the minimal fixes. Do not auto-apply fixes unless asked.

Report the actual compiler output — never claim a clean typecheck without having run it.
