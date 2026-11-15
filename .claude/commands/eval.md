---
description: Run the LLM eval harness over the labeled scenario set and summarize the scorecard
argument-hint: '[variant] [--check]'
---

Run the Webhook Failure Investigator eval harness and report the results.

**Guard:** If the eval harness doesn't exist yet (no `pnpm eval` script and no `server/src/eval/` module), tell the user the eval harness arrives in roadmap Phase 8, point them at `docs/ROADMAP.md`, and stop. (As of Phase 8 PR2 the harness exists — `pnpm eval` runs it — so the guard passes.)

Steps:

1. If `$ARGUMENTS` names a prompt variant, pass it through: `pnpm eval <variant>`; otherwise run the `default` (production) prompt. As of Phase 8 PR3 the registry (`server/src/eval/prompt-variants.ts`) ships two variants: `default` (the current `diagnosis-v2` prompt) and `regressed-no-grounding` (the production prompt with the grounding invariant removed — the A/B control that demonstrates the harness catches a weakened prompt). An unknown variant is rejected with the list of available ones. Each variant stamps its own `version` on the run, so its scorecard exports under a distinct filename and is diffable against the default.
2. Run the harness with `pnpm eval`, which seeds the labeled scenarios, investigates each with the selected prompt, and scores:
   - **Classification accuracy** — did it pick the correct `failureCategory`?
   - **Grounding quality** — did the explanation cite the expected evidence fields?
   - **Confidence calibration** — low confidence on genuinely ambiguous cases, high on clear ones.
   - A real run needs `OPENAI_API_KEY` (it spends on ~11 investigations) and a reachable Postgres; `WFI_FAKE_LLM=1 pnpm eval` runs a no-key plumbing check (same canned diagnosis for every scenario — not a quality measurement).
3. Present the compact scorecard the harness prints: overall accuracy, grounding pass rate, per-category breakdown, calibration, and the token/cost accounting.
4. A real run also exports a timestamped JSON + Markdown scorecard to `docs/eval/`. Call out regressions vs. the previous run/version (compare against the prior `docs/eval/` files) and list any scenarios that failed, with the gap.
5. **Quality gate (opt-in):** adding `--check` enforces a minimum bar — `pnpm eval --check` exits non-zero when classification accuracy or grounding pass rate falls below the threshold (defaults 0.8 / 0.8, overridable via `WFI_EVAL_MIN_ACCURACY` / `WFI_EVAL_MIN_GROUNDING`). This is the key-gated `eval-threshold` gate from [planned-ci.md](../../docs/planned-ci.md); it only enforces on a real run (fake mode prints a skip notice, since the canned diagnosis is not a quality measurement).

Report the numbers exactly as produced — never estimate or fabricate eval results.
