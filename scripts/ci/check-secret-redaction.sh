#!/usr/bin/env bash
# secret-redaction-guard — assert no raw secrets live in seed / fixture / snapshot DATA.
#
# Scope is intentionally DATA ONLY. It does not scan `*.test.ts`: redaction unit/integration
# tests legitimately feed raw secrets into the redactor to prove it strips them. This guard
# protects stored/seeded data and committed snapshots, per the CLAUDE.md core rule that secrets
# are redacted before storage. Near-empty today; it goes live once PR4 adds the scenario seeds.
set -euo pipefail

# Patterns that indicate an unredacted secret value. `[REDACTED]` markers never match these.
patterns=(
  'Bearer [A-Za-z0-9._-]{16,}'
  'sk[-_][A-Za-z0-9_-]{16,}'
  'whsec_[A-Za-z0-9]{16,}'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
)

# Data paths to scan: the seed script, the scenario fixtures (PR4), and any test snapshots.
# Non-existent pathspecs simply yield nothing.
mapfile -t files < <(git ls-files -- \
  'server/prisma/seed.ts' \
  'server/prisma/scenarios' \
  '*__snapshots__*')

if [ "${#files[@]}" -eq 0 ]; then
  echo "secret-redaction-guard: no seed/fixture/snapshot data to scan yet — ok"
  exit 0
fi

found=0
for pattern in "${patterns[@]}"; do
  matches=$(grep -En -- "$pattern" "${files[@]}" || true)
  if [ -n "$matches" ]; then
    echo "secret-redaction-guard: possible raw secret matching /${pattern}/:"
    echo "$matches"
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  echo "secret-redaction-guard: FAILED — redact secrets in seed/fixture/snapshot data before committing."
  exit 1
fi

echo "secret-redaction-guard: no raw secrets in ${#files[@]} data file(s) — ok"
