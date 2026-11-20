import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

// Manual, REAL-MODEL screenshot capture for the portfolio README (Phase 11). This is intentionally
// separate from playwright.config.ts (the deterministic fake-LLM happy-path that CI runs):
//
//   - It boots the server WITHOUT the WFI_FAKE_LLM override, so the server's own dotenv wins and a
//     real OPENAI_API_KEY in the repo-root .env drives genuine diagnoses + chat — the shots show a
//     real model name and real cost, not `fake-llm · $0.0000`. This SPENDS (one investigate + one
//     follow-up per run).
//   - It never runs in CI. CI invokes `pnpm --filter @wfi/web e2e` → playwright.config.ts, which
//     `testIgnore`s screenshots.spec.ts. This config is only reached via `pnpm e2e:screenshots`.
//   - Dedicated ports (API 3200, web 5373) so it can't collide with `pnpm dev` (3000/5173) or the
//     fake e2e (3100/5273), and reuseExistingServer:false so it always boots a fresh REAL server
//     (never accidentally reuses a fake-mode one).
//
// Prereqs: a reachable, migrated Postgres (`docker compose up -d postgres`) and OPENAI_API_KEY set
// in .env with WFI_FAKE_LLM unset/0. Run: `pnpm --filter @wfi/web e2e:screenshots`.

const API_PORT = '3200';
const WEB_PORT = '5373';
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_HEALTH = `http://localhost:${API_PORT}/health`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /screenshots\.spec\.ts$/,
  // Real model calls (investigate + a tool loop, then a streamed follow-up) are slower than the fake.
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: WEB_URL,
    viewport: { width: 1280, height: 900 },
    // Dark theme: emulate the OS preference AND the spec sets localStorage `wfi-theme=dark` pre-paint.
    colorScheme: 'dark',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Real mode: no WFI_FAKE_LLM here, so server dotenv (.env) decides — unset/0 ⇒ real OpenAI.
      command: 'pnpm --filter @wfi/server dev',
      url: API_HEALTH,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: API_PORT },
    },
    {
      command: `pnpm --filter @wfi/web exec vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: API_PORT },
    },
  ],
});
