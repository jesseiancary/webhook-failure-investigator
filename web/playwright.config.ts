import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

// Happy-path end-to-end config. Playwright boots BOTH halves of the stack itself, on dedicated ports
// (API 3100, web 5273) and behind the deterministic fake-LLM flag (WFI_FAKE_LLM=1), so the full flow
// — submit -> investigate -> diagnosis -> follow-up — runs with no OpenAI key and no network.
//
// Why dedicated ports: a normal `pnpm dev` occupies 3000/5173 WITHOUT the fake flag. If the e2e
// shared those ports (and reused that server), `investigate` would hit real OpenAI — non-deterministic,
// slower, and the canned-diagnosis assertions below would never match. On 3100/5273 the only servers
// that ever answer are the fake-mode ones Playwright starts here, so it runs alongside a dev server
// untouched. CI always starts fresh (reuseExistingServer:false); locally it may reuse a running e2e
// server on these ports for faster iteration — safe, since any server there is already in fake mode.
//
// It still needs a reachable, migrated Postgres: the server reads DATABASE_URL from the repo-root
// .env (docker compose on 5433 for this repo). The flow creates its own event, so no seed is needed.
// Run with `pnpm --filter @wfi/web e2e`.

const API_PORT = '3100';
const WEB_PORT = '5273';
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_HEALTH = `http://localhost:${API_PORT}/health`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // The API, on a dedicated port with the deterministic fake LLM wired in.
      command: 'pnpm --filter @wfi/server dev',
      url: API_HEALTH,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { WFI_FAKE_LLM: '1', PORT: API_PORT },
    },
    {
      // The Vite dev server on a dedicated port; PORT points its API proxy at the server above.
      // Invoke vite directly (not via the `dev` script) so --port reaches it — `pnpm run dev --`
      // forwards the literal `--` to vite, which then ignores the port and falls back to 5173.
      command: `pnpm --filter @wfi/web exec vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { PORT: API_PORT },
    },
  ],
});
