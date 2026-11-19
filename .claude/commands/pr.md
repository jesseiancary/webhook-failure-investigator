---
description: Read all uncommitted changes and generate a PR title + description as copy-pasteable markdown
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), SlashCommand(/portfolio)
---

Generate a pull-request title and description for the current uncommitted changes.

**Do not run any git mutation** (no branch, commit, push, or `gh pr create`) — the user handles that manually. This command produces text and refreshes the portfolio doc (step 1); it makes no git changes.

Steps:

1. **Refresh the portfolio doc first.** Invoke the `/portfolio` command (via the SlashCommand tool) to regenerate/update `docs/PORTFOLIO.md` from the current state of the project. Do this before inspecting the diff so any resulting change to `docs/PORTFOLIO.md` is part of the change set this PR documents. If `/portfolio` reports no changes, continue normally.
2. Inspect the changes:
   - `git status --short` (includes untracked files).
   - `git diff HEAD` for tracked modifications.
   - For untracked files, read them so their content is reflected in the description.
3. Infer the intent of the change set as a whole (what and why), grouping related edits.
4. Output a single fenced markdown code block (so it can be copied verbatim) containing:
   - A concise, conventional-commit-style **title** on the first line (e.g. `feat(web): ...`, `chore(tooling): ...`).
   - A **Summary** section (1–3 sentences on what and why).
   - A **Changes** bulleted list grouped logically.
   - A **Test plan** / verification checklist when applicable.
   - Any noteworthy caveats, follow-ups, or deferred items.

Keep it faithful to the actual diff — do not invent changes that aren't present. If there are no uncommitted changes, say so and stop.
