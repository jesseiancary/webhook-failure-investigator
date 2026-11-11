---
description: Run the Playwright happy-path end-to-end test against the fake-LLM server
---

Run the Webhook Failure Investigator end-to-end happy path: submit → investigate → read diagnosis → ask a follow-up.

**Guard:** If no Playwright config or e2e specs exist yet (no `web/playwright.config.*` and no e2e spec files), tell the user the Playwright happy-path e2e is the open **Phase 7** verification item in `docs/ROADMAP.md`, and stop. This command comes alive automatically once that spec lands.

Once the spec exists:

1. Run the suite with the deterministic offline model enabled — `WFI_FAKE_LLM=1` (see `server/src/diagnosis/fake-llm.ts`) — so the flow is reproducible and makes no paid OpenAI calls. This mirrors how CI runs it (CI deliberately has no `OPENAI_API_KEY`).
2. Ensure Postgres is available for the server under test (`docker compose up -d db`, `POSTGRES_PORT=5433`) and migrations are applied.
3. Run `pnpm --filter @wfi/web exec playwright test` (install browsers first with `playwright install` if they're missing).
4. On pass, report succinctly. On failure, identify the failing step in the flow, surface the Playwright trace/output, and propose the minimal fix without auto-applying.

Report the actual Playwright output — never claim a green e2e without having run it.
