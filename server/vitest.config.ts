import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Exclude the live OpenAI tests (*.live.int.test.ts) from the default run. They are gated by
    // hasOpenAIKey() (describe.skipIf), so they'd skip in keyless CI anyway — but a developer's local
    // .env carries a real OPENAI_API_KEY, which `pnpm test` loads, so without this exclude those files
    // would make real, paid, non-deterministic OpenAI calls on every local run. Their logic is covered
    // deterministically by the stubbed-client int tests (diagnosis.service.int.test.ts,
    // diagnosis.routes.int.test.ts, chat.routes.int.test.ts). To run the live tests on purpose (verify
    // end-to-end against a real model — needs a real OPENAI_API_KEY and a reachable test Postgres):
    //   WFI_RUN_LIVE=1 pnpm --filter server test
    // (optionally narrow to one file, e.g. `… test src/diagnosis/chat.live.int.test.ts`).
    exclude:
      process.env.WFI_RUN_LIVE === '1'
        ? [...configDefaults.exclude]
        : [...configDefaults.exclude, '**/*.live.int.test.ts'],
    // Integration tests share one Postgres and reset it in beforeEach. Run test files one at a
    // time so a file's reset never wipes another file's in-flight rows. The suite is small, so
    // the serial cost is negligible; tests within a file still run normally.
    fileParallelism: false,
  },
});
