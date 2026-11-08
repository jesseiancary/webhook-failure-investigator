import type { Scenario } from './types.js';

// GitHub delivery that never received a response — the receiver did not reply within the timeout.
// No response fields at all; the cause is the ETIMEDOUT error text plus the latency hitting the limit.
const scenario: Scenario = {
  key: 'seed_github_timeout',
  description: 'GitHub delivery timed out — no response, ETIMEDOUT after 10s.',
  submission: {
    source: 'github',
    eventType: 'pull_request',
    payload: {
      action: 'opened',
      number: 42,
      repository: { full_name: 'acme/widgets' },
    },
    headers: {
      'x-github-event': 'pull_request',
      'x-github-delivery': '7d5b8f31-5a1c-11ef-badc-0242ac110003',
      'x-hub-signature-256': '[REDACTED]',
      'content-type': 'application/json',
    },
    attempts: [
      {
        requestUrl: 'https://hooks.acme-app.com/webhooks/github',
        requestMethod: 'POST',
        requestHeaders: {
          'content-type': 'application/json',
          'x-github-event': 'pull_request',
          'x-hub-signature-256': '[REDACTED]',
        },
        requestBody: { action: 'opened', number: 42, repository: { full_name: 'acme/widgets' } },
        latencyMs: 10000,
        errorText:
          'ETIMEDOUT: request to https://hooks.acme-app.com/webhooks/github timed out after 10000ms',
      },
    ],
  },
  expected: {
    category: 'timeout',
    evidence: [
      'attempts[0].errorText contains "ETIMEDOUT" and "timed out"',
      'attempts[0].latencyMs == 10000 (hit the timeout limit)',
      'attempts[0] has no responseStatus (no reply received)',
    ],
  },
};

export default scenario;
