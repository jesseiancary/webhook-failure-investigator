import { prisma } from '../db/client.js';

// Shared process lifecycle for the repo's CLI entry points (prisma/seed.ts, eval/cli.ts). Run the
// script's main(), disconnect Prisma on success, and on failure log the error, disconnect, and exit
// non-zero so a broken run fails loudly. Kept in one place so the two entry points can't drift. The
// entry-point guard (`process.argv[1] === fileURLToPath(import.meta.url)`) stays at each call site,
// where `import.meta.url` is available and where the decision to guard differs (cli.ts guards so a
// unit test can import it; seed.ts always runs).
export function runEntrypoint(main: () => Promise<void>): void {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (err: unknown) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
