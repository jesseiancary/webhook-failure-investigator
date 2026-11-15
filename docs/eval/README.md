# Eval scorecards

Committed output of the LLM eval harness (`pnpm eval`, Phase 8). Each real run drops a timestamped
pair here so diagnosis quality is **diffable across prompt versions**:

- `<promptVersion>-<timestamp>.json` — the machine-readable report (`meta`, `accounting`, and the full
  `scorecard` including per-scenario rows). This is the diffable source of truth.
- `<promptVersion>-<timestamp>.md` — the same run rendered as a human-readable scorecard.

## Running

```sh
pnpm eval                 # real run — needs OPENAI_API_KEY and a reachable Postgres; spends on ~11 investigations
WFI_FAKE_LLM=1 pnpm eval  # plumbing check — no key, no export (the fake returns one canned diagnosis for every scenario)
```

A real run seeds the labeled scenarios, investigates each, scores classification / grounding /
calibration, prints the scorecard, and writes the files above. A fake run only prints — it never
exports, because its numbers verify wiring, not quality.

The prompt A/B seam (`pnpm eval <prompt-version>`) lands in **PR3**; until then only the current
default prompt version runs.

> The first real scorecard is generated and committed by the maintainer with a live key — it is not
> produced during implementation (no OpenAI spend in CI or PRs).
