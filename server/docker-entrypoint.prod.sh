#!/bin/sh
# Production entrypoint for the @wfi/server runtime image (Phase 10 — Railway deploy).
#
# Applies any pending migrations against DATABASE_URL, then execs the passed CMD (node dist/index.js).
# Unlike the dev entrypoint it NEVER seeds — demo data is loaded manually and deliberately in prod.
#
# The prisma CLI is available in the slim runtime image because it copies the full workspace
# node_modules (prisma is a devDependency installed in the deps stage); the schema/migration engine
# needs openssl, which the runtime stage installs. WORKDIR is /app/server, so ./prisma/schema.prisma
# and ./node_modules/.bin/prisma both resolve.
set -e

echo "[entrypoint] applying database migrations (prisma migrate deploy)…"
./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

echo "[entrypoint] starting: $*"
exec "$@"
