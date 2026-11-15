---
description: Run the LLM eval harness over the labeled scenario set and summarize the scorecard
argument-hint: '[prompt-version]'
---

Run the Webhook Failure Investigator eval harness and report the results.

**Guard:** If the eval harness doesn't exist yet (no `pnpm eval` script and no `server/src/eval/` module), tell the user the eval harness arrives in roadmap Phase 8, point them at `docs/ROADMAP.md`, and stop. (As of Phase 8 PR2 the harness exists — `pnpm eval` runs it — so the guard passes.)

Steps:

1. If `$ARGUMENTS` names a prompt version, pass it to `pnpm eval <prompt-version>`; otherwise run the current/default prompt. Note: the prompt A/B seam lands in PR3, so until then only the current default version runs — any other argument is rejected with a pointer to PR3.
2. Run the harness with `pnpm eval`, which seeds the labeled scenarios, investigates each, and scores:
   - **Classification accuracy** — did it pick the correct `failureCategory`?
   - **Grounding quality** — did the explanation cite the expected evidence fields?
   - **Confidence calibration** — low confidence on genuinely ambiguous cases, high on clear ones.
   - A real run needs `OPENAI_API_KEY` (it spends on ~11 investigations) and a reachable Postgres; `WFI_FAKE_LLM=1 pnpm eval` runs a no-key plumbing check (same canned diagnosis for every scenario — not a quality measurement).
3. Present the compact scorecard the harness prints: overall accuracy, grounding pass rate, per-category breakdown, calibration, and the token/cost accounting.
4. A real run also exports a timestamped JSON + Markdown scorecard to `docs/eval/`. Call out regressions vs. the previous run/version (compare against the prior `docs/eval/` files) and list any scenarios that failed, with the gap.

Report the numbers exactly as produced — never estimate or fabricate eval results.
