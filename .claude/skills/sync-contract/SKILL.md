---
name: sync-contract
description: Propagate a changed server request/response shape across the shared Zod schema, the OpenAI structured-output/tool usage, and the hand-mirrored web types — keeping the define-once contract from drifting. Use when adding or changing an API shape.
---

# Sync a contract change end to end

The project's rule is **define Zod schemas once and share them** between API validation and OpenAI structured output. There is one acknowledged gap: the web client **hand-mirrors** response shapes in `web/src/api/types.ts` with no compile-time guard (a documented tradeoff; a future `@wfi/contracts` package would close it). Until that package exists, use these steps whenever a request/response shape changes so the mirror can't silently drift.

> Some steps depend on later phases. If a target doesn't exist yet, note its roadmap phase (`docs/ROADMAP.md`) and do the parts that are ready.

## 1. Change the Zod source (never a duplicate)

Edit the single source of truth for the shape:
- Ingest / manual submission / capture input → `server/src/ingest/schemas.ts`.
- Diagnosis output → `server/src/diagnosis/diagnosis.schema.ts` (also drives OpenAI Structured Outputs via `zodResponseFormat`).
- Tool params → `server/src/diagnosis/tools/schemas.ts`.
- Chat request → `server/src/diagnosis/chat.schema.ts`.
- Taxonomy values → `server/src/domain/failure-category.ts` (`FAILURE_CATEGORIES`); the Prisma enum mirror is locked by a test — update both.

Do **not** introduce a second, divergent shape for the same data.

## 2. Confirm the LLM contract still derives from it

If a diagnosis/tool shape changed, verify the structured-output and tool definitions still come from that same Zod schema (`zodResponseFormat` / `zodFunction` in `server/src/diagnosis/openai.ts` and `tools/toolkit.ts`) — no hand-written JSON Schema duplicate.

## 3. Propagate to the web mirror

Update the matching type in `web/src/api/types.ts` and any consumer in `web/src/api/client.ts`, routes, or components. Keep field names and optionality identical to the server shape. If the server now returns a summary projection vs. a full row, mirror exactly that.

## 4. Verify

Run `/check` (typecheck + lint + format + test + build). For a diagnosis-shape change, also run `grounding-auditor` to confirm the `evidence[]` contract still holds. Add or update a test that exercises the new shape on both sides.

## Checklist

- [ ] Zod source updated (single definition, no duplicate shape)
- [ ] OpenAI structured-output / tool defs still derive from the Zod schema
- [ ] `web/src/api/types.ts` (+ consumers) mirror the new shape exactly
- [ ] Taxonomy change? Prisma enum + `FAILURE_CATEGORIES` both updated
- [ ] `/check` green; grounding re-audited if diagnosis shape changed
