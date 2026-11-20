import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { expect, test } from '@playwright/test';

// Portfolio demo screenshots (Phase 11) — DARK MODE, REAL MODEL, manual only.
//
// This runs under playwright.screenshots.config.ts, which boots the server in real mode (a live
// OPENAI_API_KEY from .env — it SPENDS) on dedicated ports, and is `testIgnore`d by the default
// config so it never runs in CI. The flow mirrors the happy-path e2e (submit → investigate →
// grounded diagnosis → cited-log link → follow-up chat) but, because real model output is not
// deterministic, it asserts on STRUCTURE (a diagnosis rendered, a citation present, a streamed
// answer) rather than exact wording.
//
// Regenerate with:
//   docker compose up -d postgres        # a reachable, migrated Postgres (port 5433 for this repo)
//   pnpm --filter @wfi/web e2e:screenshots
//
// Output lands in docs/assets/*.png, embedded by the root README.

const ASSET_DIR = path.resolve(process.cwd(), '..', 'docs', 'assets');

// Wait for sonner's auto-dismissing toasts to clear so they never sit over a screenshot.
async function waitForToastsToClear(page: import('@playwright/test').Page): Promise<void> {
  for (const label of ['Event submitted', 'Investigation complete']) {
    await expect(page.getByText(label, { exact: true })).toBeHidden({ timeout: 15_000 });
  }
}

test('capture dark-mode demo screenshots: diagnosis → citation → chat → dashboard', async ({
  page,
}) => {
  await mkdir(ASSET_DIR, { recursive: true });

  // Force dark theme before first paint — mirrors the inline script in index.html (key `wfi-theme`),
  // so there's no light flash and the whole run is dark.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('wfi-theme', 'dark');
    } catch {
      /* storage disabled — colorScheme:'dark' emulation still applies */
    }
  });

  // Submit a fresh 401 delivery (a real model reliably reads this as an auth failure).
  await page.goto('/submit');
  await page.getByLabel('Source').fill('github');
  await page.getByLabel('Event type').fill('push');
  await page.getByLabel('Payload (JSON)').fill('{"action":"opened"}');
  await page.getByLabel('Request URL').fill('https://example.com/webhook');
  await page.getByLabel('Response status').fill('401');
  await page.getByRole('button', { name: /submit event/i }).click();
  await expect(page).toHaveURL(/\/events\/[^/]+$/);

  // 1) Investigate — real diagnosis with a confidence badge, evidence citations, and the token/cost
  //    line (now a real model + real cost). Wait on structure, not wording.
  await page.getByRole('button', { name: /^investigate$/i }).click();
  await expect(page.getByText('Diagnosis', { exact: true })).toBeVisible({ timeout: 60_000 });
  const firstCitation = page.locator('button[title^="Open attempt #"]').first();
  await expect(firstCitation).toBeVisible({ timeout: 60_000 });
  await waitForToastsToClear(page);
  await page.screenshot({ path: path.join(ASSET_DIR, 'diagnosis.png'), fullPage: true });

  // 2) Grounding made interactive — click the first evidence citation; it opens the delivery attempt
  //    it references.
  await firstCitation.click();
  // The cited attempt expands — assert on the toggle's state, not on body text (a real diagnosis may
  // itself mention "Response headers", which would make a text match ambiguous).
  await expect(page.locator('button[aria-expanded="true"]').first()).toBeVisible();
  await waitForToastsToClear(page);
  await page.screenshot({ path: path.join(ASSET_DIR, 'citation.png'), fullPage: true });

  // 3) Streaming follow-up chat. The assistant's model·cost meta line renders only once the stream
  //    completes, so waiting for it captures a finished answer, not a mid-stream caret.
  await page
    .getByLabel('Follow-up question')
    .fill('What is the single best next step to fix this?');
  await page.getByRole('button', { name: /^send$/i }).click();
  await expect(page.locator('div.justify-start p.text-muted-foreground').last()).toBeVisible({
    timeout: 90_000,
  });
  await waitForToastsToClear(page);
  await page.screenshot({ path: path.join(ASSET_DIR, 'chat.png'), fullPage: true });

  // 4) Dashboard last — by now the DB holds the event we just created plus any seeded scenarios
  //    (run `pnpm eval` / `db:seed` beforehand for a populated list). Wait for real rows so the shot
  //    never captures the loading skeletons.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible();
  await expect(page.locator('a[href^="/events/"]').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: path.join(ASSET_DIR, 'dashboard.png'), fullPage: true });
});
