#!/bin/sh
# Dev-container entrypoint for the @wfi/server service.
#
# Makes a bare `docker compose up` self-contained: apply any pending migrations, load the
# idempotent seed library, then hand off to the passed CMD (the tsx-watch dev server). Prisma
# itself is a devDependency, so this runs only in the `dev` image — production migrate-on-deploy
# is a Phase 10 concern, handled separately.
set -e

echo "[entrypoint] applying database migrations (prisma migrate deploy)…"
pnpm --filter @wfi/server exec prisma migrate deploy

# Idempotent: seeded rows use stable seed_* ids, so re-running on every boot is safe. Guarded to
# non-production so a prod image can never auto-seed demo data.
if [ "${NODE_ENV:-development}" != "production" ]; then
  echo "[entrypoint] seeding scenario library (idempotent)…"
  pnpm --filter @wfi/server db:seed
fi

echo "[entrypoint] starting: $*"
exec "$@"
