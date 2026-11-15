# Eval scorecards

Committed output of the LLM eval harness (`pnpm eval`, Phase 8). Each real run drops a timestamped
pair here so diagnosis quality is **diffable across prompt versions**:

- `<promptVersion>-<timestamp>.json` — the machine-readable report (`meta`, `accounting`, and the full
  `scorecard` including per-scenario rows). This is the diffable source of truth.
- `<promptVersion>-<timestamp>.md` — the same run rendered as a human-readable scorecard.

## Running

```sh
pnpm eval                          # real run — needs OPENAI_API_KEY and a reachable Postgres; spends on ~11 investigations
WFI_FAKE_LLM=1 pnpm eval           # plumbing check — no key, no export (the fake returns one canned diagnosis for every scenario)
pnpm eval regressed-no-grounding   # A/B a prompt variant (see below); exports under the variant's own version
pnpm eval --check                  # also enforce the quality thresholds (exit non-zero below the bar) — real runs only
```

A real run seeds the labeled scenarios, investigates each, scores classification / grounding /
calibration, prints the scorecard, and writes the files above. A fake run only prints — it never
exports, because its numbers verify wiring, not quality.

**Prompt A/B (Phase 8 PR3).** The optional first argument selects a prompt variant from the registry
(`server/src/eval/prompt-variants.ts`): `default` (the current `diagnosis-v2` prompt) or
`regressed-no-grounding` (the production prompt with the grounding invariant removed — a deliberate
regression used to demonstrate the harness catches a weakened prompt). Each variant stamps its own
`version`, so its scorecard lands under a distinct filename and diffs directly against the default.

**Quality gate (opt-in).** Adding `--check` enforces a minimum classification accuracy and grounding
pass rate (defaults 0.8/0.8, overridable via `WFI_EVAL_MIN_ACCURACY` / `WFI_EVAL_MIN_GROUNDING`) and
exits non-zero below the bar. It only enforces on a real run — fake mode prints a skip notice, since
the canned diagnosis is not a quality measurement. This is the key-gated `eval-threshold` gate; see
[../planned-ci.md](../planned-ci.md).

> The first real scorecard is generated and committed by the maintainer with a live key — it is not
> produced during implementation (no OpenAI spend in CI or PRs).
