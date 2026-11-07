#!/usr/bin/env bash
#
# PostToolUse hook: format + typecheck an edited TypeScript file.
#
# DEFENSIVE BY DESIGN: this repo is built in phases. The TypeScript toolchain
# (package.json, tsconfig, prettier, tsc) does not exist until roadmap Phase 2.
# Until then — and any time a prerequisite is missing — this hook exits 0 and
# does nothing. Once Phase 2 lands it "comes alive" automatically with no edit.
#
# Exit codes: 0 = ok / no-op. 2 = typecheck failed (surfaced to Claude).

set -uo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"

# Read the hook payload from stdin.
payload="$(cat)"

# Extract the edited file path. Prefer jq; fall back to a minimal parser.
if command -v jq >/dev/null 2>&1; then
  file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')"
else
  file_path="$(printf '%s' "$payload" \
    | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | head -n1 \
    | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
fi

# --- Guard clauses: any miss is a clean no-op --------------------------------

# No file path resolved (e.g. multi-file op, or a tool without one).
[ -n "${file_path:-}" ] || exit 0

# Only act on TypeScript sources.
case "$file_path" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac

# Toolchain not scaffolded yet (pre-Phase 2).
[ -f "$project_dir/package.json" ] || exit 0

# File must exist on disk.
[ -f "$file_path" ] || exit 0

# --- Format (best effort; never blocks) --------------------------------------

if npx --no-install prettier --version >/dev/null 2>&1; then
  npx --no-install prettier --write "$file_path" >/dev/null 2>&1 || \
    echo "post-edit-check: prettier could not format $file_path" >&2
fi

# --- Typecheck (blocks on failure) -------------------------------------------

if [ -f "$project_dir/tsconfig.json" ] && npx --no-install tsc --version >/dev/null 2>&1; then
  if ! tsc_output="$(cd "$project_dir" && npx --no-install tsc --noEmit 2>&1)"; then
    echo "post-edit-check: tsc --noEmit reported type errors:" >&2
    echo "$tsc_output" >&2
    exit 2
  fi
fi

exit 0
