// Seed entrypoint. The labeled scenario library lands in Roadmap Phase 3 (PR4);
// until then this is a graceful no-op so `pnpm --filter server db:seed` works.
async function main(): Promise<void> {
  console.log('db:seed — no scenarios yet (seeded scenario library arrives in Phase 3 PR4).');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
