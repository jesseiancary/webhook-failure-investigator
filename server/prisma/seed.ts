// Seed CLI entry (run via `pnpm --filter server db:seed` / `prisma db seed`). Thin wrapper: the
// loader and the scenario library live under src/ (typechecked + unit-tested); this file just runs
// it and manages the process lifecycle. Kept here by Prisma convention (package.json `prisma.seed`).
import { runEntrypoint } from '../src/cli/run-entrypoint.js';
import { seedApiDocs, seedScenarios } from '../src/ingest/seed.js';

async function main(): Promise<void> {
  const { created: scenarios } = await seedScenarios();
  const { created: docs } = await seedApiDocs();
  console.log(
    `db:seed — seeded ${scenarios} labeled scenario(s) and ${docs} API reference doc(s).`,
  );
}

runEntrypoint(main);
