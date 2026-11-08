---
description: Generate and apply a Prisma migration from the current schema changes
argument-hint: '[migration-name]'
---

Create and apply a Prisma migration for the Webhook Failure Investigator.

**Guard:** If Prisma isn't set up yet (no `server/prisma/schema.prisma`), tell the user the data layer arrives in roadmap Phase 3, point them at `docs/ROADMAP.md`, and stop.

Steps:

1. Show the current schema diff so the user can see what will change (`git diff -- server/prisma/schema.prisma`).
2. Derive a descriptive migration name from `$ARGUMENTS`, or from the nature of the change if none is given (kebab-case, e.g. `add-investigation-cost-fields`).
3. Run `pnpm --filter server prisma migrate dev --name <name>`.
4. Confirm the migration applied cleanly and that the generated Prisma client is up to date.
5. Report the new migration directory and a one-line summary of the schema change.

Do not edit existing committed migrations; only create new ones. If the migration would be destructive (dropping a column/table with data), call that out and confirm before proceeding.
