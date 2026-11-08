#!/usr/bin/env bash
#
# Frontmatter lint: assert that Claude tooling files carry the required YAML
# frontmatter keys. Keeps commands/agents/skills loadable by Claude Code.
#
# Exit 0 = all good. Exit 1 = one or more files missing required keys.

set -uo pipefail

status=0

# require_keys <file> <key>...
require_keys() {
  local file="$1"
  shift
  if [ ! -f "$file" ]; then
    return 0
  fi
  # Frontmatter must open on the very first line.
  if [ "$(head -n1 "$file")" != "---" ]; then
    echo "missing frontmatter (no leading '---'): $file"
    status=1
    return 0
  fi
  # Extract the frontmatter block (between the first two '---' lines).
  local fm
  fm="$(awk 'NR==1{next} /^---[[:space:]]*$/{exit} {print}' "$file")"
  local key
  for key in "$@"; do
    if ! printf '%s\n' "$fm" | grep -qE "^${key}:"; then
      echo "missing '${key}:' in frontmatter: $file"
      status=1
    fi
  done
}

shopt -s nullglob

for f in .claude/commands/*.md; do
  require_keys "$f" description
done

for f in .claude/agents/*.md; do
  require_keys "$f" name description
done

for f in .claude/skills/*/SKILL.md; do
  require_keys "$f" name description
done

if [ "$status" -ne 0 ]; then
  echo "frontmatter-lint: failures found" >&2
  exit 1
fi

echo "frontmatter-lint: all tooling files have required keys"
