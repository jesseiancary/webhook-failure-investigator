#!/usr/bin/env bash
#
# PreToolUse hook: gate `git commit` on a clean typecheck (and tests, once they exist).
#
# DEFENSIVE BY DESIGN: no-ops (exit 0) unless the Bash command is a `git commit`
# AND the toolchain is scaffolded (roadmap Phase 2+). Comes alive automatically.
#
# Exit codes: 0 = allow. 2 = block the commit (surfaced to Claude).

set -uo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
payload="$(cat)"

# Extract the Bash command being run.
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')"
else
  cmd="$(printf '%s' "$payload" \
    | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | head -n1 \
    | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
fi

# --- Guard clauses: any miss is a clean no-op --------------------------------

# Only gate git commits.
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# Toolchain not scaffolded yet (pre-Phase 2).
[ -f "$project_dir/package.json" ] || exit 0

# --- Gate: typecheck ---------------------------------------------------------

if [ -f "$project_dir/tsconfig.json" ] && npx --no-install tsc --version >/dev/null 2>&1; then
  # Build mode (`-b`) typechecks every referenced workspace from the root tsconfig.
  if ! out="$(cd "$project_dir" && npx --no-install tsc -b --noEmit 2>&1)"; then
    echo "pre-commit-gate: blocking commit — tsc --noEmit failed:" >&2
    echo "$out" >&2
    exit 2
  fi
fi

exit 0
