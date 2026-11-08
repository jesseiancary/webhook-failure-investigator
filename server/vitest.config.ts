import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests share one Postgres and reset it in beforeEach. Run test files one at a
    // time so a file's reset never wipes another file's in-flight rows. The suite is small, so
    // the serial cost is negligible; tests within a file still run normally.
    fileParallelism: false,
  },
});
