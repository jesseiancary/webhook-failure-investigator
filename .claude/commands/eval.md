---
description: Run the LLM eval harness over the labeled scenario set and summarize the scorecard
argument-hint: "[prompt-version]"
---

Run the Webhook Failure Investigator eval harness and report the results.

**Guard:** If the eval harness doesn't exist yet (no `pnpm eval` script and no `server/eval/` module), tell the user the eval harness arrives in roadmap Phase 8, point them at `docs/ROADMAP.md`, and stop.

Steps:
1. If `$ARGUMENTS` names a prompt version, target that version; otherwise use the current/default prompt.
2. Run the harness (e.g. `pnpm eval`), which scores each labeled scenario for:
   - **Classification accuracy** — did it pick the correct `failureCategory`?
   - **Grounding quality** — did the explanation cite the expected evidence fields?
   - **Confidence calibration** — low confidence on genuinely ambiguous cases, high on clear ones.
3. Present a compact scorecard: overall accuracy, grounding pass rate, and a per-category breakdown.
4. Call out regressions vs. the previous run/version and list any scenarios that failed, with the gap.

Report the numbers exactly as produced — never estimate or fabricate eval results.
