---
title: Webhook Failure Investigator
description: An AI assistant that diagnoses failed webhook deliveries and explains the root cause in plain language, with every claim grounded in the actual delivery logs rather than guessed. Full-stack TypeScript with a hallucination-resistant LLM pipeline (structured output, tool calling, and evals).

thumbnail:
screenshots:
githubUrl: https://github.com/jesseiancary/webhook-failure-investigator
liveUrl: https://webhook-failure-investigator-production.up.railway.app/
tech:
  - TypeScript
  - OpenAI SDK
  - React
  - PostgreSQL
techStack:
  - label: Backend
    items:
      - Node.js
      - TypeScript
      - Express
      - PostgreSQL
      - Prisma
      - Zod
      - OpenAI SDK
      - pino
  - label: Frontend
    items:
      - React
      - TypeScript
      - Vite
      - TailwindCSS
      - shadcn/ui
      - TanStack Query
      - React Router
      - SSE streaming
  - label: Testing & quality
    items:
      - Vitest
      - Supertest
      - Playwright
      - LLM eval harness
      - ESLint
      - Prettier
  - label: Ops
    items:
      - Docker Compose
      - GitHub Actions CI
      - Railway
  - label: Architecture
    items:
      - pnpm monorepo
      - '@wfi/contracts shared Zod package'
featured: true
order: 1
date: 2026-11-19
---

## Overview

Developers integrating third-party APIs constantly hit webhook delivery failures, and triaging them - is this an expired token, a payload mismatch, a timeout, rate limiting, or a bug on the receiving end? - is tedious, repetitive work. The Webhook Failure Investigator ingests a failed delivery (the event, request payload, response, and delivery logs) and uses an LLM to classify the failure into a defined taxonomy, explain the root cause in plain language, recommend concrete remediation steps, and answer follow-up questions with the original event held as context.

The project had two deliberate goals: to demonstrate **production-grade LLM integration** (not a prompt-in-a-box demo), and to serve as a genuinely usable portfolio piece. Every feature is wired into a real backend workflow with a typed data model, tests, and measurable quality.

## Tech stack

- **Backend** - Node.js, TypeScript, Express, PostgreSQL, Prisma, Zod, pino. The LLM path uses the OpenAI SDK with Structured Outputs (via `zodResponseFormat`) and the Responses API for tool calling and reasoning.
- **Frontend** - React, TypeScript, Vite, TailwindCSS, and shadcn/ui, with TanStack Query, React Router, and SSE for streaming the follow-up chat.
- **Testing & quality** - Vitest and Supertest for unit/integration, Playwright for end-to-end, plus a custom LLM eval harness scoring classification accuracy, grounding, and confidence calibration. ESLint and Prettier round it out.
- **Ops** - Docker Compose with multi-stage builds and full-stack hot reload, GitHub Actions CI, and a Dockerfile-native Railway deploy with managed Postgres and migrations-on-boot.
- **Architecture** - a pnpm monorepo whose shared `@wfi/contracts` package is the single source of truth: one set of Zod schemas drives API validation, the LLM's structured-output contract, and the web wire types.

## What I built

- **A grounded structured-output diagnosis engine.** A Zod schema drives OpenAI Structured Outputs, so the model returns a validated diagnosis object - failure category (from an 8-value taxonomy), root cause, confidence score, an `evidence[]` array citing specific log fields, remediation steps, and a reachability assessment. The same schema validates API input, eliminating contract drift.
- **Tool calling instead of data dumps.** Rather than stuffing raw logs into the prompt, the model is given retrieval tools (`get_delivery_history`, `get_event_payload`, `fetch_api_docs`) and calls them in a bounded loop. Each tool call is persisted as a conversation message.
- **An anti-hallucination grounding invariant.** Every claim must cite a real log field. When evidence is thin, the model is required to return `insufficient_evidence` with `isSpeculative: true` rather than inventing a cause - and the eval harness verifies it actually does.
- **Streaming follow-up chat with deliberate context management.** Multi-turn Q&A scoped to a single investigation, streamed over SSE, with a per-request token budget, log-body summarization/truncation with pointers back to full data, and a cheaper model tier for follow-ups.
- **A React UI for AI output.** Events dashboard, investigation detail with confidence badges and evidence citations that link to the underlying log fields, a remediation checklist, token/cost surfaced per run, streaming chat panel, and a manual submission form - with light/dark theming and proper loading/empty/error states.
- **An LLM eval harness.** Scores classification accuracy (overall and per-category), grounding quality, and confidence calibration against a labeled scenario set, tagged by prompt version so quality regressions are attributable and catchable in CI.
- **Full containerization & live deployment.** `docker compose up` runs server + web + Postgres with in-container hot reload; a multi-stage production image serves the compiled web bundle on a single origin and runs Prisma migrations on boot. It is deployed live on Railway with managed Postgres.

## Engineering decisions & challenges

- **Keeping an LLM honest.** The hardest and most important constraint was making hallucination structurally difficult rather than just asking the model to behave. The combination of schema-enforced evidence citations, tool-gated data access, an explicit `insufficient_evidence` escape hatch, and an eval that fails the build when grounding regresses is the heart of the project.
- **A define-once contract across three consumers.** API validation, the LLM structured-output contract, and the frontend types all need the same shapes. I extracted a Prisma-free `@wfi/contracts` package so the Zod schemas are authored once, with compile-time and runtime assertions guarding the Prisma-enum lock-step.
- **Migrating the diagnosis client to the Responses API.** The original `chat.completions` + tools path forced reasoning off. I migrated the diagnosis client to the Responses API (`responses.parse` + `zodTextFormat`) to re-enable model reasoning alongside function tools, while keeping the tool-free follow-up chat on the cheaper `chat.completions` path.
- **Cost and latency discipline as a first-class concern.** Every model call records `model`, prompt/completion tokens, and `costUsd` on the investigation record, feeding both the UI credibility signal and a planned global daily cost cap. Model tiering and a curated (deliberately not exhaustive) few-shot set keep spend down.
- **Secret redaction at the ingestion choke point.** Auth headers and tokens are redacted before any delivery attempt is persisted or logged, enforced at a single `createEvent` boundary so seeded and live-captured data are handled identically.

## Outcome

A fully functioning, containerized full-stack application, deployed live on Railway, that takes a real webhook failure and produces a grounded, cited, actionable diagnosis - then lets the user interrogate it conversationally. The build was executed as a sequence of shippable phases (data model → diagnosis → tool calling → chat → UI → evals → containerization → deploy), each gated by verification, with CI enforcing typecheck, lint, format, tests, and build on every change. It demonstrates practical LLM engineering - structured output, tool calling, grounding, context management, confidence handling, and measurable quality via evals - wired into a real, tested, deployable product.
