# syntax=docker/dockerfile:1
#
# Multi-stage build for the @wfi/server workspace. Build context is the REPO ROOT
# (see docker-compose.yml / `docker build -f server/Dockerfile .`) because the pnpm
# workspace install needs the root lockfile + every workspace manifest.
#
# Targets:
#   dev     — full toolchain, runs `tsx watch` via the migrate+seed entrypoint. Used by compose.
#   runtime — slim, non-root. Migrates on boot, then serves the API + the compiled web bundle on one
#             origin. The Phase 10 deploy base, and the LAST stage so a plain `docker build` / Railway
#             (which builds the final stage) selects it without needing `--target`.

# --- deps: install the whole workspace once (cached on manifest + lockfile changes) ----------
FROM node:22-alpine AS deps
# Prisma's query engine needs openssl on alpine.
RUN apk add --no-cache openssl
RUN corepack enable
WORKDIR /app
# Only the files that affect dependency resolution, so this layer caches across source edits.
# Two install-time side effects need their inputs present here: server's `postinstall` runs
# `prisma generate` (needs server/prisma), and @wfi/contracts' `prepare` compiles its dist (needs the
# contracts source + its tsconfig + the shared base tsconfig). Without the contracts manifest the pnpm
# workspace glob would silently skip it, leaving no `@wfi/contracts` symlink and breaking resolution.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY server/prisma ./server/prisma
COPY contracts/package.json contracts/tsconfig.json ./contracts/
COPY contracts/src ./contracts/src
RUN pnpm install --frozen-lockfile

# --- build: compile server/dist AND the web bundle from source --------------------------------
# The prisma client is already generated in deps. The web bundle (web/dist) is built here so the
# single runtime image can serve it on the same origin as the API (Phase 10, B1).
FROM deps AS build
WORKDIR /app
COPY . .
RUN pnpm --filter @wfi/server build
RUN pnpm --filter @wfi/web build

# --- dev: hot-reload toolchain used by docker-compose (source is bind-mounted at runtime) -----
# The entrypoint migrate-deploys + seeds (idempotent) before the dev server boots, so a bare
# `docker compose up` is investigable immediately. Source + node_modules come from the compose
# bind-mount and named volumes; the COPY below just makes the image runnable standalone.
#
# NOTE: unlike `runtime`, this target stays root — standard for a dev container, and on WSL2 it keeps
# the bind-mounted tree writable without UID juggling. Today's entrypoint only writes to the DB and
# the node_modules volume, so nothing root-owned lands in the mount. If you extend it to write INTO
# /app (e.g. an interactive `prisma migrate dev` that emits a migration file), those files will be
# root-owned on the host — add a matching USER / `chown` then.
FROM deps AS dev
ENV NODE_ENV=development
WORKDIR /app
COPY . .
EXPOSE 3000
ENTRYPOINT ["sh", "/app/server/docker-entrypoint.sh"]
CMD ["pnpm", "--filter", "@wfi/server", "dev"]

# --- runtime: slim non-root image that migrates then serves API + web -------------------------
# Copies the installed workspace (pnpm's symlinked node_modules + the root .pnpm store) plus the
# server's dist/prisma and the compiled web bundle. Not maximally pruned — a future pass can swap to
# `pnpm deploy --prod` for a smaller image — but it is alpine-slim, carries no build toolchain, and
# runs as a non-root user. Kept LAST so it is the default build target (see header).
FROM node:22-alpine AS runtime
# openssl: Prisma's query + migration engines need it (migrate-on-deploy runs in the entrypoint).
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/
COPY --from=build /app/server/node_modules /app/server/node_modules
COPY --from=build /app/server/dist /app/server/dist
COPY --from=build /app/server/prisma /app/server/prisma
COPY --from=build /app/server/package.json /app/server/package.json
COPY --from=build /app/server/docker-entrypoint.prod.sh /app/server/docker-entrypoint.prod.sh
# The compiled web bundle, served by the API on the same origin (app.ts → serveWebIfPresent). Lives at
# /app/web/dist, i.e. ../web/dist from the server workdir — the path app.ts resolves by default.
COPY --from=build /app/web/dist /app/web/dist
# @wfi/contracts is a workspace dep: server/node_modules/@wfi/contracts symlinks to /app/contracts,
# so the slim runtime needs its manifest + compiled dist (the `exports` entry) or the import dangles.
# Its node_modules carries the `zod` symlink into the root .pnpm store (copied above) — contracts'
# dist imports zod at runtime, so without it the import fails with ERR_MODULE_NOT_FOUND (zod).
COPY --from=build /app/contracts/package.json /app/contracts/package.json
COPY --from=build /app/contracts/dist /app/contracts/dist
COPY --from=build /app/contracts/node_modules /app/contracts/node_modules
# node:22-alpine ships a non-root `node` user.
USER node
EXPOSE 3000
# Migrate-deploy (never seed) then boot the compiled server.
ENTRYPOINT ["sh", "/app/server/docker-entrypoint.prod.sh"]
CMD ["node", "dist/index.js"]
