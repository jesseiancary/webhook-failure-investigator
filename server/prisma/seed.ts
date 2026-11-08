// Seed CLI entry (run via `pnpm --filter server db:seed` / `prisma db seed`). Thin wrapper: the
// loader and the scenario library live under src/ (typechecked + unit-tested); this file just runs
// it and manages the process lifecycle. Kept here by Prisma convention (package.json `prisma.seed`).
import { prisma } from '../src/db/client.js';
import { seedScenarios } from '../src/ingest/seed.js';

async function main(): Promise<void> {
  const { created } = await seedScenarios();
  console.log(`db:seed — seeded ${created} labeled scenario(s).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
