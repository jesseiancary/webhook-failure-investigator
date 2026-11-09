// Shared gate for the key-requiring live OpenAI tests (diagnosis.live.int.test.ts and
// diagnosis.routes.live.int.test.ts). Centralized so the two files can't drift on what counts as a
// usable key.
//
// The `.env.example` placeholder counts as "no key": config/env loads .env into process.env, so a
// developer who copied the example but never pasted a real key must still get a clean skip — not a
// real call that fails on a bogus credential.
const PLACEHOLDER_KEY = 'sk-your-key-here';

/** True when a usable OPENAI_API_KEY is present (real, non-empty, not the example placeholder). */
export function hasOpenAIKey(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return key != null && key !== '' && key !== PLACEHOLDER_KEY;
}
