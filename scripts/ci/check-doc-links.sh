#!/usr/bin/env bash
#
# Internal link check: verify that relative markdown links in tracked docs
# point at files that actually exist. External (http/mailto) links and pure
# '#anchor' links are ignored. Keeps cross-references from rotting.
#
# Exit 0 = all internal links resolve. Exit 1 = one or more are broken.

set -uo pipefail

status=0

# All tracked markdown files.
mapfile -t files < <(git ls-files '*.md')

for f in "${files[@]}"; do
  dir="$(dirname "$f")"
  # Pull link targets out of ](target) and keep the path up to ')' or whitespace.
  while IFS= read -r target; do
    [ -n "$target" ] || continue
    case "$target" in
      http://* | https://* | mailto:* | \#* | '') continue ;;
    esac
    # Drop any #anchor or ?query suffix.
    target="${target%%#*}"
    target="${target%%\?*}"
    [ -n "$target" ] || continue
    if [ ! -e "$dir/$target" ]; then
      echo "broken link in $f -> $target"
      status=1
    fi
  done < <(grep -oE '\]\([^)]+\)' "$f" | sed -E 's/^\]\(([^) ]+).*/\1/')
done

if [ "$status" -ne 0 ]; then
  echo "doc-link-check: broken internal links found" >&2
  exit 1
fi

echo "doc-link-check: all internal links resolve"
