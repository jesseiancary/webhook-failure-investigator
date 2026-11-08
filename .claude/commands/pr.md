---
description: Read all uncommitted changes and generate a PR title + description as copy-pasteable markdown
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*)
---

Generate a pull-request title and description for the current uncommitted changes.

**Do not run any git mutation** (no branch, commit, push, or `gh pr create`) — the user handles that manually. This command only reads and produces text.

Steps:

1. Inspect the changes:
   - `git status --short` (includes untracked files).
   - `git diff HEAD` for tracked modifications.
   - For untracked files, read them so their content is reflected in the description.
2. Infer the intent of the change set as a whole (what and why), grouping related edits.
3. Output a single fenced markdown code block (so it can be copied verbatim) containing:
   - A concise, conventional-commit-style **title** on the first line (e.g. `feat(web): ...`, `chore(tooling): ...`).
   - A **Summary** section (1–3 sentences on what and why).
   - A **Changes** bulleted list grouped logically.
   - A **Test plan** / verification checklist when applicable.
   - Any noteworthy caveats, follow-ups, or deferred items.
4. Append a **CI gates to consider** advisory section (in its own clearly-labeled block below the PR description):
   - Read [docs/planned-ci.md](../../docs/planned-ci.md). If it does not exist, note that briefly and skip this section — do not fail.
   - Using its mapping table, match the gates whose "relevant when" trigger covers the files in this change set.
   - List the matches as a short checklist, marking each as either **runnable now** (Phase 1 gates) or **planned** (later-phase gates whose toolchain/data layer isn't present yet).
   - Frame it as "suggested gates to run or add before committing this PR." Do not repeat gates irrelevant to the change set.

Keep it faithful to the actual diff — do not invent changes that aren't present. If there are no uncommitted changes, say so and stop.

**Advisory only:** the CI-gates step only _reads_ `docs/planned-ci.md` and _lists_ suggestions. It must not run, install, or configure any gate, and (as above) must not perform any git mutation.
