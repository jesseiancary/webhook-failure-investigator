import { expect, test } from '@playwright/test';

// The Phase 7 happy path, end to end against the fake-LLM stack (see playwright.config.ts):
// submit a 401 delivery -> investigate -> read the grounded diagnosis -> click an evidence citation
// and confirm it opens the exact delivery attempt it cites -> ask a follow-up and see it stream.
//
// The grounding invariant is what this guards in the UI: the diagnosis must cite a real log field,
// and that citation must be a live link to the log — not just prose that correlates.

test('submit → investigate → diagnosis → cited log link → follow-up chat', async ({ page }) => {
  // 1) Submit a fresh event with a single 401 delivery attempt.
  await page.goto('/submit');
  await page.getByLabel('Source').fill('github');
  await page.getByLabel('Event type').fill('push');
  await page.getByLabel('Payload (JSON)').fill('{"action":"opened"}');
  await page.getByLabel('Request URL').fill('https://example.com/webhook');
  await page.getByLabel('Response status').fill('401');
  await page.getByRole('button', { name: /submit event/i }).click();

  // The app navigates to the new event's detail page.
  await expect(page).toHaveURL(/\/events\/[^/]+$/);

  // 2) Investigate — the fake LLM returns a deterministic grounded `authentication` diagnosis.
  await page.getByRole('button', { name: /^investigate$/i }).click();

  // 3) The diagnosis renders: category, confidence, and the grounded root cause. Allow a generous
  //    timeout — investigate POSTs, then the UI invalidates and refetches the run before rendering.
  await expect(page.getByText('Diagnosis', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Authentication')).toBeVisible();
  await expect(page.getByText(/rejected the delivery with HTTP 401/)).toBeVisible();

  // 4) The evidence citation is a real link to the log field it cites. Clicking it opens the
  //    matching delivery attempt (its collapsed body becomes visible) — grounding made interactive.
  const citation = page.getByRole('button', { name: 'attempts[0].responseStatus' });
  await expect(citation).toBeVisible();

  const attemptToggle = page.getByRole('button', { name: /#1/ });
  await expect(attemptToggle).toHaveAttribute('aria-expanded', 'false');
  await citation.click();
  await expect(attemptToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Response headers')).toBeVisible();

  // 5) Ask a follow-up; the answer streams in token-by-token (fake client).
  await page.getByLabel('Follow-up question').fill('Why not a network failure?');
  await page.getByRole('button', { name: /^send$/i }).click();
  await expect(page.getByText(/a network fault would not have reached the endpoint/)).toBeVisible();
});
