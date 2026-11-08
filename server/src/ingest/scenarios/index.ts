import type { Scenario } from './types.js';

import stripeAuth401 from './stripe-auth-401.js';
import githubAuthSignature from './github-auth-signature.js';
import slackPayload400 from './slack-payload-400.js';
import githubTimeout from './github-timeout.js';
import stripeNetworkDns from './stripe-network-dns.js';
import githubRateLimit429 from './github-rate-limit-429.js';
import githubRetry429Then200 from './github-retry-429-then-200.js';
import slackServer5xx from './slack-server-5xx.js';
import stripeAppLogicIdempotent from './stripe-app-logic-idempotent.js';
import slackPayloadSecretRedacted from './slack-payload-secret-redacted.js';
import stripeInsufficientEvidence from './stripe-insufficient-evidence.js';

// The labeled scenario library. One grounded failure per entry, spread across Stripe/GitHub/Slack
// and covering all eight failure categories. The seed loader (../seed.ts) persists each
// `submission`; the Phase 8 eval reads each `expected` label. Add a new scenario by creating a file
// here (see /seed-scenario) and appending it to this array.
export const scenarios: Scenario[] = [
  stripeAuth401,
  githubAuthSignature,
  slackPayload400,
  githubTimeout,
  stripeNetworkDns,
  githubRateLimit429,
  githubRetry429Then200,
  slackServer5xx,
  stripeAppLogicIdempotent,
  slackPayloadSecretRedacted,
  stripeInsufficientEvidence,
];

export type { Scenario } from './types.js';
