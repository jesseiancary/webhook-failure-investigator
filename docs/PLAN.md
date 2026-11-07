# Webhook Failure Investigator — Engineering Plan

> An AI assistant that investigates failed webhook deliveries and explains what went wrong — grounded in the actual logs, not guesses.

## 1. Problem & Goals

Developers integrating with third-party APIs constantly hit webhook delivery failures. Figuring out whether the cause is **authentication**, **payload validation**, **timeout**, **network failure**, **rate limiting**, a **server error** on the receiver, or **application logic** is tedious and repetitive.

This app ingests a failed delivery — the webhook event, the request payload, the response, and the delivery logs — and uses an LLM to:

1. **Classify** the failure into a well-defined category.
2. **Explain** the root cause in plain language, *citing the actual log evidence*.
3. **Recommend** concrete remediation steps.
4. **Answer follow-up questions** with the original event held as context.

**Example output:**

> The webhook failed because the receiving endpoint returned HTTP 401. The request included an expired bearer token. The endpoint was reachable, so this is unlikely to be a network issue.
>
> **Recommended action:**
> - Refresh the API credentials.
> - Verify the token expiration policy.
> - Retry delivery using the original event ID.

### Project goals

- **Learn LLM integration** — structured output, tool calling, context management, grounding, confidence handling.
- **Land a job** — the primary audience is hiring managers. The app must be *fully functioning and usable*, with a live URL, a polished UI, tests, and evals — not a demo stub.

### What this demonstrates to a hiring manager

Practical LLM engineering wired into a real backend workflow: a typed data model, structured and schema-enforced model output, tool calling against real data, deliberate context-window management, anti-hallucination grounding, measurable quality via evals, and a deployed full-stack product. It connects naturally to existing webhook and payment-integration experience.

---

## 2. Tech Stack

### Backend
- **Node.js + TypeScript + Express** — matches the brief and prior experience.
- **PostgreSQL via Prisma** — type-safe client + migrations; widely recognized by reviewers.
- **Zod** — one set of schemas drives *both* API input validation *and* the LLM structured-output contract (single source of truth).
- **OpenAI SDK** (`openai`) — Structured Outputs via `zodResponseFormat` (`openai/helpers/zod`) and function/tool calling.
- **pino** structured logging + a token/cost accounting helper wrapping every model call.
- Middleware: `helmet`, `cors`, rate limiting, request-id tracing, centralized error handling.

### Frontend
- **React + TypeScript + Vite**.
- **TailwindCSS + shadcn/ui** for a clean, professional look with low effort.
- **TanStack Query** for server state; **React Router** for navigation.
- **SSE streaming** chat UI for follow-up Q&A.

### Testing & Quality
- **Vitest** (unit) + **Supertest** (API integration).
- One **Playwright** happy-path e2e over the real UI.
- ESLint + Prettier + `tsc --noEmit`.
- An **LLM eval harness** with a labeled scenario set (see §7 and Roadmap Phase 8).

### Ops
- **Docker Compose** for local dev (app + Postgres).
- **GitHub Actions** CI: typecheck, lint, test on PR.
- Deploy to **Railway / Render** with managed Postgres; secrets via env.

### Confirmed decisions
- **LLM provider:** OpenAI.
- **Frontend:** full React app (hiring managers must *see* it work).
- **Deployment:** Railway/Render → a live resume URL.
- **Data:** both a seeded scenario library *and* a live webhook-capture endpoint.

---

## 3. Architecture Overview

```
                    ┌─────────────────────────────────────┐
  Live webhooks ───▶│  POST /capture/:token  (ingest)      │
  (Stripe test etc) │                                      │
                    │  Express API (TypeScript)            │
  React UI ────────▶│   /events  /investigations  /chat    │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  Investigation Service       │
                    │  - build grounded prompt     │
                    │  - OpenAI structured output   │
                    │  - tool-calling loop          │
                    │  - confidence + evidence      │
                    └──────┬───────────────┬───────┘
                           │               │
                    ┌──────▼─────┐   ┌─────▼──────────┐
                    │ PostgreSQL │   │ OpenAI API     │
                    │ (Prisma)   │   │ (tools/schema) │
                    └────────────┘   └────────────────┘
```

**Core domain flow:** capture or seed a failed delivery → run an *investigation* (classify + root cause + remediation, grounded in logs, with a confidence score) → persist the structured diagnosis → allow threaded follow-up chat scoped to that event.

---

## 4. Data Model (Prisma)

| Model | Key fields | Notes |
|---|---|---|
| `WebhookEvent` | `id`, `source`, `eventType`, `payload` (jsonb), `headers` (jsonb), `receivedAt`, `captureToken?` | The inbound event. |
| `DeliveryAttempt` | `id`, `eventId`, `requestUrl`, `requestMethod`, `requestHeaders`, `requestBody`, `responseStatus`, `responseHeaders`, `responseBody`, `latencyMs`, `errorText?`, `attemptedAt` | **Secrets redacted** before storage. |
| `Investigation` | `id`, `eventId`, `diagnosis` (jsonb), `failureCategory` (enum), `confidence` (0–1), `model`, `promptTokens`, `completionTokens`, `costUsd`, `createdAt` | One run of the LLM analysis. |
| `InvestigationMessage` | `id`, `investigationId`, `role` (system/user/assistant/tool), `content`, `toolCalls` (jsonb), `createdAt` | The follow-up conversation thread. |
| `ApiDoc` | `id`, `provider`, `section`, `content` | Retrievable reference docs for the `fetch_api_docs` tool. Keyword retrieval in v1. |

**Failure taxonomy (enum, drives classification):**
`authentication` · `payload_validation` · `timeout` · `network_failure` · `rate_limit` · `server_error` · `application_logic` · `insufficient_evidence`

---

## 5. LLM Integration Design (the showcase)

Each item maps directly to a skill the project is meant to demonstrate.

1. **Structured output / JSON-schema enforcement.** A Zod schema → OpenAI Structured Outputs produces the diagnosis object:
   ```ts
   {
     failureCategory,            // enum above
     rootCause,                  // plain-language explanation
     confidence,                 // 0–1
     evidence: [{ field, value, note }],   // references real log fields
     remediationSteps: string[],
     reachabilityAssessment,     // was the endpoint reachable?
     isSpeculative               // true when evidence is thin
   }
   ```

2. **Tool calling for grounding.** The model is given tools instead of raw data dumps, and calls them in a bounded loop:
   - `get_delivery_history(eventId)` → prior attempts for the event.
   - `get_event_payload(eventId)` → full request/response/headers.
   - `fetch_api_docs(provider, query)` → relevant `ApiDoc` sections.
   Tool calls are persisted as `InvestigationMessage` rows.

3. **Grounding / anti-hallucination.** The system prompt requires every claim to cite evidence from retrieved data. If evidence is insufficient, the model must return `failureCategory: insufficient_evidence` with `isSpeculative: true` rather than invent a cause. Evidence citations are rendered in the UI next to the explanation.

4. **Confidence & uncertainty.** An explicit `confidence` field surfaced in the UI (High / Medium / Low). Low-confidence results prompt the user to supply more logs.

5. **Context management across follow-ups.** Chat is scoped to an `Investigation`; history is replayed within a token budget. Long log bodies are summarized/truncated with pointers so the thread stays inside the context window — deliberate management, not blind appending.

6. **Prompt engineering & classification.** A **versioned** system prompt encodes the failure taxonomy plus few-shot examples. Prompt versions are tracked so eval results are attributable to a version.

7. **Cost & latency discipline.** Per-investigation token + USD accounting stored on `Investigation`; model tiering (a cheaper model for chat follow-ups, a stronger one for the initial diagnosis); caching of identical diagnoses.

---

## 6. Claude Code Developer Tooling (`.claude/`)

> This is tooling to help *build* the repo faster and demonstrate toolchain fluency. It is unrelated to the app's OpenAI integration. It is built in **Roadmap Phase 1**.

- **`.claude/settings.json`** — permission allowlist for routine commands (pnpm/npm, prisma, vitest, tsc, read-only git); a **post-edit hook** running `tsc --noEmit` + Prettier on changed TS files; a typecheck/test gate.
- **`CLAUDE.md`** (root) — project conventions: architecture, directory layout, naming, the "ground every LLM claim in logs" rule, and test/lint commands.
- **`.claude/commands/`** — `/seed-scenario` (scaffold a seeded failure scenario), `/eval` (run the eval harness), `/migrate` (Prisma migration), `/typecheck`.
- **`.claude/agents/`** — `prompt-evaluator` (run the eval set against a prompt version, report regressions), `pr-reviewer` (review a diff against conventions).
- **`.claude/skills/add-provider/`** — repeatable steps to onboard a new webhook provider.

---

## 7. Verification Strategy

- **Local run:** `docker-compose up` → `prisma migrate dev && db:seed` → `pnpm dev`. Pick a seeded 401 scenario, run an investigation, confirm the diagnosis matches the label and cites `responseStatus: 401`.
- **Live capture:** send a test webhook to `POST /capture/:token` (curl or `stripe trigger`); confirm it appears as an event and is investigable.
- **Structured output integrity:** Vitest asserts every OpenAI response validates against the Zod schema, and that stripped logs yield `insufficient_evidence`.
- **Tool calling:** with a spy OpenAI client, assert the model calls the retrieval tools and the final answer references returned evidence.
- **Follow-up context:** an API/e2e test asserts a follow-up ("why not a network issue?") is answered using persisted event context.
- **Eval:** `/eval` runs the labeled set and prints classification accuracy + grounding pass rate; CI can gate on a threshold.
- **CI:** GitHub Actions runs typecheck + lint + tests on every PR.
- **Deployed smoke test:** after deploy, hit the live URL, run one seeded investigation and one chat follow-up.

Detailed, per-phase verification checklists live in [ROADMAP.md](./ROADMAP.md).

---

## 8. Out of Scope for v1

- Multi-provider LLM abstraction (OpenAI only; a thin interface is a noted upgrade path).
- Embeddings-based doc retrieval (keyword retrieval first).
- Multi-tenant auth / organizations (a single lightweight auth gate only).
