# Webhook Failure Investigator — Roadmap

Phased, actionable build plan. Each phase is a shippable increment; check items off as you go. The app becomes usable from **Phase 4** onward. See [PLAN.md](./PLAN.md) for the full engineering rationale.

**Legend:** `- [ ]` todo · each phase lists a **Goal**, **Skills demonstrated**, grouped sub-phases, and a **Verification** gate that must pass before moving on.

---

## Phase 1 — Claude Code Developer Tooling

**Goal:** Stand up `.claude/` tooling first so every later phase is faster and more consistent.
**Skills demonstrated:** toolchain fluency, repeatable workflows, developer experience.

### Repo conventions

- [x] Create root `CLAUDE.md` describing the project, architecture, and directory layout.
- [x] Document naming conventions and the monorepo structure (`/server`, `/web`, `/docs`).
- [x] Record the core rule: **every LLM claim must be grounded in log evidence**.
- [x] List canonical commands (install, dev, test, lint, typecheck, migrate, seed, eval).

### Settings & hooks

- [x] Create `.claude/settings.json` with a permission allowlist (pnpm/npm, prisma, vitest, tsc, read-only git).
- [x] Add a post-edit hook running `tsc --noEmit` + Prettier on changed TS files. _(defensive: no-ops until Phase 2 toolchain exists)_
- [x] Add a typecheck/test gate before commits. _(PreToolUse gate on `git commit`, defensive)_

### Slash commands (`.claude/commands/`)

- [x] `/seed-scenario` — scaffold a new seeded failure scenario (event + attempts + expected label).
- [x] `/eval` — run the LLM eval harness and print the scorecard.
- [x] `/migrate` — generate + apply a Prisma migration.
- [x] `/typecheck` — typecheck both workspaces.
- [x] `/pr` — read uncommitted changes and generate a copy-pasteable PR title + description.

### Subagents (`.claude/agents/`)

- [x] `prompt-evaluator` — run the eval set against a prompt version, report regressions.
- [x] `pr-reviewer` — review a diff against project conventions before pushing.

### Skill (`.claude/skills/`)

- [x] `add-provider` — document the repeatable steps to onboard a new webhook provider.

### Verification

- [x] A slash command runs end to end (`/typecheck` returns the graceful "toolchain not set up yet" message in the current repo, as designed).
- [x] The post-edit hook fires and formats/typechecks a sample edit. _(activated in Phase 2 PR1: switched to `tsc -b --noEmit`; verified it blocks a deliberate type error)_
- [x] `CLAUDE.md` accurately reflects the intended layout.

---

## Phase 2 — Project Foundations

**Goal:** A working monorepo skeleton with CI and local infrastructure.
**Skills demonstrated:** project setup, build tooling, CI/CD.

### Scaffolding

- [x] Initialize the monorepo (`/server`, `/web`, `/docs`) with a workspace manager (pnpm). _(PR1: pnpm workspaces)_
- [x] Configure TypeScript (shared base `tsconfig`, per-workspace configs). _(PR1: `tsconfig.base.json` + solution-style root `tsconfig.json` with project references)_
- [x] Set up ESLint + Prettier with shared config. _(PR1: flat `eslint.config.js` + `.prettierrc`)_
- [x] Set up Vitest with a sample passing test in each workspace. _(PR1: `server` + `web` sample tests pass)_

### Local infrastructure

- [x] Write `docker-compose.yml` (Postgres + app) with a named volume. _(PR3: Postgres service + `wfi_pgdata` volume + healthcheck; app runs on host via `pnpm dev` — containerizing the server is deferred to Phase 9 (Full Local Containerization))_
- [x] Add `.env.example` documenting all required env vars (DB URL, `OPENAI_API_KEY`, etc.). _(PR3)_
- [x] Add a `README` quickstart (install → compose up → migrate → dev). _(PR3: migrate/seed noted as Phase 3)_

### CI

- [x] GitHub Actions workflow: install, typecheck, lint, test on every PR. _(PR2: `.github/workflows/ci.yml` — `quality` job runs install/typecheck/lint/format/test/build; `tooling` job runs the Phase 1 gates. Detailed catalog in [planned-ci.md](./planned-ci.md))_
- [x] Branch protection notes documented. _(PR2: see [planned-ci.md](./planned-ci.md) "Branch protection")_

### Verification

- [x] `docker-compose up` starts Postgres; the app connects. _(PR3: `docker compose up -d` brings up a healthy Postgres; app-side DB connection lands with Prisma in Phase 3)_
- [x] `pnpm typecheck && pnpm lint && pnpm test` passes locally and in CI. _(PR1: green locally. PR2: CI workflow added and verified to mirror these commands locally; the "in CI" half confirms once the workflow runs on GitHub)_

---

## Phase 3 — Data Model & Ingestion

**Goal:** Persist webhook events and delivery attempts; support seeded _and_ live data.
**Skills demonstrated:** data modeling, realistic test data, real ingestion.

### Schema & migrations

- [x] Define the Prisma schema: `WebhookEvent`, `DeliveryAttempt`, `Investigation`, `InvestigationMessage`, `ApiDoc`.
- [x] Add the `failureCategory` enum (8 values per PLAN.md §4).
- [x] Generate and apply the initial migration.

### Seeded scenarios

- [x] Build a seed script with 8–12 realistic failure scenarios (Stripe/GitHub/Slack style). _(PR4: 11 scenarios in `server/src/ingest/scenarios/`, loaded via `db:seed` through the `createEvent` redaction choke point; idempotent re-seed on a `seed_` id namespace)_
- [x] Cover: 401 expired token, 400 payload mismatch, timeout, DNS/network failure, 429 rate limit, 5xx server error, 2xx application-logic/idempotency, and an ambiguous/insufficient-evidence case. _(PR4: all eight categories covered, plus a multi-attempt 429→200 retry and a body-secret redaction demo)_
- [x] Attach an expected diagnosis label to each scenario (for evals later). _(PR4: each `Scenario` carries `expected.category` + `expected.evidence[]`; not persisted — read directly by the Phase 8 eval)_

### Ingestion endpoints

- [x] `POST /capture/:token` — record real inbound webhooks (headers, body, response).
- [x] Manual submission API — paste an event + request/response + logs.
- [x] Redact secrets (auth headers, tokens) before storage.
- [x] `GET /events` and `GET /events/:id` read endpoints.

### Verification

- [x] `prisma migrate dev && db:seed` populates all scenarios. _(PR4: `db:seed` loads the 11-scenario library; re-running is idempotent)_
- [x] A test webhook sent to `/capture/:token` appears as a stored event with redacted secrets.

---

## Phase 4 — Core Diagnosis (Usable MVP)

**Goal:** Turn a stored failure into a structured, grounded diagnosis.
**Skills demonstrated:** structured output, prompt engineering, classification, cost tracking.

### Structured output

- [x] Define the Zod diagnosis schema (shared with API validation).
- [x] Wire OpenAI Structured Outputs via `zodResponseFormat`.
- [x] Map the model output into the `Investigation` record.

### Prompting

- [x] Author a versioned system prompt encoding the failure taxonomy.
- [x] Add a curated few-shot set (authentication, payload_validation, insufficient_evidence) teaching both edges of the grounding rule — deliberately not one-per-category, for cost discipline.
- [x] Store the prompt version on each `Investigation`.

### Endpoint & accounting

- [x] `POST /events/:id/investigate` runs a diagnosis and persists it.
- [x] Record `promptTokens`, `completionTokens`, `costUsd`, and `model` per run.

### Verification

- [x] Every response validates against the Zod schema (unit test).
- [x] Seeded 401 scenario classifies as `authentication` with correct remediation.
- [x] Token/cost fields are populated and plausible.

---

## Phase 5 — Tool Calling & Grounding

**Goal:** Let the model retrieve real data and refuse to guess.
**Skills demonstrated:** tool calling, grounding, anti-hallucination.

### Tools

- [x] Implement `get_delivery_history(eventId)`.
- [x] Implement `get_event_payload(eventId)`.
- [x] Implement `fetch_api_docs(provider, query)` (keyword retrieval over `ApiDoc`).
- [x] Run a bounded tool-calling loop; persist each tool call as an `InvestigationMessage`.

### Grounding guardrails

- [x] Require evidence citations referencing real log fields in `evidence[]`.
- [x] Return `insufficient_evidence` + `isSpeculative: true` when data is thin.
- [x] Seed `ApiDoc` content for the demo providers.

### Verification

- [x] With a spy client, assert the model calls the retrieval tools.
- [x] The final answer cites fields that actually appear in returned data.
- [x] Stripping the logs yields `insufficient_evidence` rather than a fabricated cause.

### Follow-ups

- [ ] Evaluate migrating the diagnosis client to the OpenAI Responses API to re-enable model
      reasoning alongside function tools (currently forced to `reasoning_effort: 'none'` on
      `chat.completions`, which disables reasoning on the tool path).

---

## Phase 6 — Follow-up Chat & Context Management

**Goal:** Multi-turn Q&A scoped to a single investigation.
**Skills demonstrated:** context-window management, streaming.

### Threaded chat

- [ ] `POST /investigations/:id/chat` with SSE streaming responses.
- [ ] Persist user/assistant/tool messages in `InvestigationMessage`.
- [ ] Replay history scoped to the investigation on each turn.

### Context budgeting

- [ ] Enforce a token budget per request.
- [ ] Summarize/truncate long log bodies with pointers back to full data.
- [ ] Use a cheaper model tier for follow-ups.

### Verification

- [ ] A follow-up ("why not a network issue?") answers from persisted context.
- [ ] A very long log thread stays within the context limit without erroring.

---

## Phase 7 — React Frontend

**Goal:** A polished UI a hiring manager can explore without reading code.
**Skills demonstrated:** full-stack delivery, UX for AI output.

### Core screens

- [ ] Events dashboard (list of captured/seeded failures, filter by category/status).
- [ ] Investigation detail: diagnosis, confidence badge, evidence citations, remediation checklist, retry-by-event-id affordance.
- [ ] Streaming chat panel on the investigation detail page.
- [ ] Scenario submission form (manual event entry).
- [ ] Give `GET /events/:id/investigations` a summary projection (drop the full `diagnosis` Json blob, mirroring `listEvents`) once the history view's field needs are known — it currently returns full rows.

### Polish

- [ ] Tailwind + shadcn/ui styling, responsive layout, light/dark.
- [ ] Loading/empty/error states; optimistic UX via TanStack Query.
- [ ] Surface token/cost per investigation (nice credibility signal).

### Verification

- [ ] Playwright happy-path e2e: submit → investigate → read diagnosis → ask a follow-up.
- [ ] Evidence citations visibly link to the underlying log fields.

---

## Phase 8 — Eval Harness & Quality

**Goal:** Make diagnosis quality measurable and regression-safe.
**Skills demonstrated:** LLM evaluation, measurable quality.

### Harness

- [ ] Build a labeled scenario set from the seeds (category + expected evidence).
- [ ] Score classification accuracy per prompt version.
- [ ] Score grounding quality (does the answer cite real evidence?).
- [ ] Spot-check confidence calibration (low confidence ↔ genuinely ambiguous cases).

### Reporting

- [ ] `/eval` prints a scorecard; export results to `docs/`.
- [ ] Optionally gate CI on a minimum accuracy/grounding threshold.
- [ ] Publish the scorecard in the README.

### Verification

- [ ] Running the harness on two prompt versions shows a comparable scorecard.
- [ ] A deliberately regressed prompt is caught by the eval.

---

## Phase 9 — Full Local Containerization

**Goal:** Run the entire stack — server, web, and Postgres — in containers with one command, achieving dev/prod parity without giving up a fast edit loop.
**Skills demonstrated:** Docker multi-stage builds, container networking, orchestration, dev/prod parity.

> Deferred here (not earlier) on purpose: the prompt-engineering (Phases 4–6) and UI (Phase 7) work iterates hardest, and a fast host `pnpm dev` loop — especially on WSL2, where bind-mount file-watching into containers is slow — keeps that work friction-free. The images written here become the basis for the Phase 10 production build.

### Service images

- [ ] `server/Dockerfile` — multi-stage (deps → build → slim runtime on `node:22-alpine`), runs as a non-root user, boots `dist/index.js`.
- [ ] `web/Dockerfile` — a dev target (Vite dev server) now; stub a production static/nginx target to be finished in Phase 10.
- [ ] Per-workspace `.dockerignore` (exclude `node_modules`, `dist`, `.env`, coverage).

### Compose orchestration

- [ ] Add `server` and `web` services to `docker-compose.yml`, networked to `postgres`.
- [ ] Gate app startup on DB health: `depends_on: postgres: { condition: service_healthy }`.
- [ ] Container-network `DATABASE_URL` (host `postgres`, not `localhost`); load env via `env_file`.
- [ ] Preserve hot-reload in-container: bind-mount source + a named volume for `node_modules`; enable watch polling for reliable file-watching on WSL2.
- [ ] Keep the Postgres-only path available (compose profile or `docker-compose.override.yml`) so host `pnpm dev` still works.

### Docs & parity

- [ ] README: document `docker compose up` (full stack) vs. host `pnpm dev`, and the container vs. host `DATABASE_URL`.
- [ ] `.env.example`: distinguish host (`localhost`) from container (`postgres`) `DATABASE_URL`.

### Verification

- [ ] `docker compose up` brings up postgres + server + web; `curl localhost:3000/health` returns `{"status":"ok"}` from the container.
- [ ] The containerized server connects to the containerized Postgres and runs a seeded investigation end to end.
- [ ] Editing a `.ts`/`.tsx` source file hot-reloads inside the container.
- [ ] `docker compose down -v` cleans up; the host `pnpm dev` path still works.

---

## Phase 10 — Deploy & Hardening

**Goal:** A live, reasonably secure URL.
**Skills demonstrated:** deployment, security awareness, ops.

### Deploy

- [ ] Provision Railway/Render service + managed Postgres.
- [ ] Configure env/secrets; run migrations on deploy.
- [ ] Set up a production build for `/web` served by or alongside the API.

### Hardening

- [ ] Verify secret/header redaction in both storage and logs.
- [ ] Add rate limiting on public endpoints.
- [ ] Add a lightweight auth gate on write endpoints.
- [ ] Set OpenAI usage/cost guardrails (per-request + daily cap).

### Verification

- [ ] Deployed smoke test: run one seeded investigation and one follow-up on the live URL.
- [ ] No secrets appear in stored records or logs.

---

## Phase 11 — Portfolio Presentation

**Goal:** Make the work legible and compelling to hiring managers.
**Skills demonstrated:** communication, technical writing.

### Documentation

- [ ] README: architecture diagram, live demo link, quickstart.
- [ ] Demo GIF/screenshots of the full flow.
- [ ] "Engineering decisions" writeup (why structured output, how grounding is enforced, cost controls, context management).
- [ ] Embed the eval scorecard.
- [ ] One-paragraph "what this demonstrates" summary for non-technical reviewers.

### Verification

- [ ] A new reader can go from README → live demo → understanding the LLM design in under 5 minutes.
- [ ] Every claim in the README is backed by something runnable in the repo.
