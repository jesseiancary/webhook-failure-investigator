---
name: build-eval-harness
description: Stand up the Phase 8 LLM eval harness that the /eval command and prompt-evaluator agent already expect — scoring classification accuracy, grounding, and confidence calibration from the labeled seed scenarios. Use when building Phase 8.
---

# Build the eval harness (Phase 8)

Make diagnosis quality measurable and regression-safe. The tooling that *consumes* a harness already exists — the `/eval` command and the `prompt-evaluator` agent both currently emit a "arrives in Phase 8" message. This skill builds the harness they call.

> This is **Phase 8** (`docs/ROADMAP.md`). The labeled data it needs already landed in Phase 3. Build only when starting Phase 8; the parts below map 1:1 to the roadmap's Phase 8 checklist.

## 1. Use the labels that already exist

Each seed scenario carries ground truth: `expected.category` + `expected.evidence[]` (`server/src/ingest/scenarios/`, shape in `scenarios/types.ts`). These are **not persisted** — read them directly. Do not invent a new label format; reuse this one.

## 2. Score per prompt version

Run a diagnosis for each scenario at a given `promptVersion` (`server/src/diagnosis/prompt.ts`) and score:
- **Classification accuracy** — predicted `failureCategory` vs. `expected.category`, overall and per category.
- **Grounding** — does the diagnosis `evidence[]` cite the `expected.evidence[]` fields? This is the invariant from `CLAUDE.md`; a confident answer that cites nothing real is a grounding failure even if the category is right.
- **Confidence calibration** — low confidence on the genuinely ambiguous / `insufficient_evidence` scenarios, high on clear ones.

Run deterministically and cheaply where possible — honor `WFI_FAKE_LLM=1` (`server/src/diagnosis/fake-llm.ts`) for wiring/plumbing tests; score real model quality with a real key, recording `model` + token/cost per run like every other OpenAI call.

## 3. Wire it up

- Add a `pnpm eval` script (root + `server`) so `/eval [prompt-version]` runs it.
- Emit a compact scorecard (overall accuracy, grounding pass rate, per-category breakdown) and export it to `docs/` so it can be committed and diffed across prompt versions.
- Optionally gate CI on a minimum accuracy/grounding threshold; publish the scorecard in the README (Phase 11).

## 4. Verify (roadmap gate)

- Running the harness on two prompt versions produces a comparable scorecard.
- A deliberately regressed prompt is **caught** by the eval (the key test that the harness has teeth).
- `/eval` and `prompt-evaluator` now run against it instead of the deferral message.
