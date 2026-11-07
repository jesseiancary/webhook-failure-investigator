# Webhook Failure Investigator — Roadmap

Phased, actionable build plan. Each phase is a shippable increment; check items off as you go. The app becomes usable from **Phase 4** onward. See [PLAN.md](./PLAN.md) for the full engineering rationale.

**Legend:** `- [ ]` todo · each phase lists a **Goal**, **Skills demonstrated**, grouped sub-phases, and a **Verification** gate that must pass before moving on.

---

## Phase 1 — Claude Code Developer Tooling

**Goal:** Stand up `.claude/` tooling first so every later phase is faster and more consistent.
**Skills demonstrated:** toolchain fluency, repeatable workflows, developer experience.

### Repo conventions
- [ ] Create root `CLAUDE.md` describing the project, architecture, and directory layout.
- [ ] Document naming conventions and the monorepo structure (`/server`, `/web`, `/docs`).
- [ ] Record the core rule: **every LLM claim must be grounded in log evidence**.
- [ ] List canonical commands (install, dev, test, lint, typecheck, migrate, seed, eval).

### Settings & hooks
- [ ] Create `.claude/settings.json` with a permission allowlist (pnpm/npm, prisma, vitest, tsc, read-only git).
- [ ] Add a post-edit hook running `tsc --noEmit` + Prettier on changed TS files.
- [ ] Add a typecheck/test gate before commits.

### Slash commands (`.claude/commands/`)
- [ ] `/seed-scenario` — scaffold a new seeded failure scenario (event + attempts + expected label).
- [ ] `/eval` — run the LLM eval harness and print the scorecard.
- [ ] `/migrate` — generate + apply a Prisma migration.
- [ ] `/typecheck` — typecheck both workspaces.

### Subagents (`.claude/agents/`)
- [ ] `prompt-evaluator` — run the eval set against a prompt version, report regressions.
- [ ] `pr-reviewer` — review a diff against project conventions before pushing.

### Skill (`.claude/skills/`)
- [ ] `add-provider` — document the repeatable steps to onboard a new webhook provider.

### Verification
- [ ] A slash command runs end to end (e.g. `/typecheck`).
- [ ] The post-edit hook fires and formats/typechecks a sample edit.
- [ ] `CLAUDE.md` accurately reflects the intended layout.

---

## Phase 2 — Project Foundations

**Goal:** A working monorepo skeleton with CI and local infrastructure.
**Skills demonstrated:** project setup, build tooling, CI/CD.

### Scaffolding
- [ ] Initialize the monorepo (`/server`, `/web`, `/docs`) with a workspace manager (pnpm).
- [ ] Configure TypeScript (shared base `tsconfig`, per-workspace configs).
- [ ] Set up ESLint + Prettier with shared config.
- [ ] Set up Vitest with a sample passing test in each workspace.

### Local infrastructure
- [ ] Write `docker-compose.yml` (Postgres + app) with a named volume.
- [ ] Add `.env.example` documenting all required env vars (DB URL, `OPENAI_API_KEY`, etc.).
- [ ] Add a `README` quickstart (install → compose up → migrate → dev).

### CI
- [ ] GitHub Actions workflow: install, typecheck, lint, test on every PR.
- [ ] Branch protection notes documented.

### Verification
- [ ] `docker-compose up` starts Postgres; the app connects.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` passes locally and in CI.

---

## Phase 3 — Data Model & Ingestion

**Goal:** Persist webhook events and delivery attempts; support seeded *and* live data.
**Skills demonstrated:** data modeling, realistic test data, real ingestion.

### Schema & migrations
- [ ] Define the Prisma schema: `WebhookEvent`, `DeliveryAttempt`, `Investigation`, `InvestigationMessage`, `ApiDoc`.
- [ ] Add the `failureCategory` enum (8 values per PLAN.md §4).
- [ ] Generate and apply the initial migration.

### Seeded scenarios
- [ ] Build a seed script with 8–12 realistic failure scenarios (Stripe/GitHub/Slack style).
- [ ] Cover: 401 expired token, 400 payload mismatch, timeout, DNS/network failure, 429 rate limit, 5xx server error, 2xx application-logic/idempotency, and an ambiguous/insufficient-evidence case.
- [ ] Attach an expected diagnosis label to each scenario (for evals later).

### Ingestion endpoints
- [ ] `POST /capture/:token` — record real inbound webhooks (headers, body, response).
- [ ] Manual submission API — paste an event + request/response + logs.
- [ ] Redact secrets (auth headers, tokens) before storage.
- [ ] `GET /events` and `GET /events/:id` read endpoints.

### Verification
- [ ] `prisma migrate dev && db:seed` populates all scenarios.
- [ ] A test webhook sent to `/capture/:token` appears as a stored event with redacted secrets.

---

## Phase 4 — Core Diagnosis (Usable MVP)

**Goal:** Turn a stored failure into a structured, grounded diagnosis.
**Skills demonstrated:** structured output, prompt engineering, classification, cost tracking.

### Structured output
- [ ] Define the Zod diagnosis schema (shared with API validation).
- [ ] Wire OpenAI Structured Outputs via `zodResponseFormat`.
- [ ] Map the model output into the `Investigation` record.

### Prompting
- [ ] Author a versioned system prompt encoding the failure taxonomy.
- [ ] Add few-shot examples covering each category.
- [ ] Store the prompt version on each `Investigation`.

### Endpoint & accounting
- [ ] `POST /events/:id/investigate` runs a diagnosis and persists it.
- [ ] Record `promptTokens`, `completionTokens`, `costUsd`, and `model` per run.

### Verification
- [ ] Every response validates against the Zod schema (unit test).
- [ ] Seeded 401 scenario classifies as `authentication` with correct remediation.
- [ ] Token/cost fields are populated and plausible.

---

## Phase 5 — Tool Calling & Grounding

**Goal:** Let the model retrieve real data and refuse to guess.
**Skills demonstrated:** tool calling, grounding, anti-hallucination.

### Tools
- [ ] Implement `get_delivery_history(eventId)`.
- [ ] Implement `get_event_payload(eventId)`.
- [ ] Implement `fetch_api_docs(provider, query)` (keyword retrieval over `ApiDoc`).
- [ ] Run a bounded tool-calling loop; persist each tool call as an `InvestigationMessage`.

### Grounding guardrails
- [ ] Require evidence citations referencing real log fields in `evidence[]`.
- [ ] Return `insufficient_evidence` + `isSpeculative: true` when data is thin.
- [ ] Seed `ApiDoc` content for the demo providers.

### Verification
- [ ] With a spy client, assert the model calls the retrieval tools.
- [ ] The final answer cites fields that actually appear in returned data.
- [ ] Stripping the logs yields `insufficient_evidence` rather than a fabricated cause.

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

## Phase 9 — Deploy & Hardening

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

## Phase 10 — Portfolio Presentation

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
