import type { Scenario } from './types.js';

// Two-attempt delivery: throttled 429 on the first try, then accepted 200 after honoring Retry-After.
// Demonstrates multi-attempt history — the terminal state is success, but the story is rate limiting.
const scenario: Scenario = {
  key: 'seed_github_retry_429_then_200',
  description: 'GitHub delivery: 429 on attempt 1 (Retry-After), 200 on attempt 2 after backoff.',
  submission: {
    source: 'github',
    eventType: 'release',
    payload: {
      action: 'published',
      release: { tag_name: 'v1.4.0' },
      repository: { full_name: 'acme/widgets' },
    },
    headers: {
      'x-github-event': 'release',
      'x-github-delivery': '9f7d0153-5a1e-11ef-9f3e-0242ac110005',
      'x-hub-signature-256': '[REDACTED]',
      'content-type': 'application/json',
    },
    attempts: [
      {
        requestUrl: 'https://hooks.acme-app.com/webhooks/github',
        requestMethod: 'POST',
        requestHeaders: {
          'content-type': 'application/json',
          'x-github-event': 'release',
          'x-hub-signature-256': '[REDACTED]',
        },
        requestBody: { action: 'published', release: { tag_name: 'v1.4.0' } },
        responseStatus: 429,
        responseHeaders: { 'content-type': 'application/json', 'retry-after': '2' },
        responseBody: { error: 'rate_limited', message: 'Slow down, retry after 2s' },
        latencyMs: 58,
      },
      {
        requestUrl: 'https://hooks.acme-app.com/webhooks/github',
        requestMethod: 'POST',
        requestHeaders: {
          'content-type': 'application/json',
          'x-github-event': 'release',
          'x-hub-signature-256': '[REDACTED]',
        },
        requestBody: { action: 'published', release: { tag_name: 'v1.4.0' } },
        responseStatus: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: { received: true },
        latencyMs: 72,
      },
    ],
  },
  expected: {
    category: 'rate_limit',
    evidence: [
      'attempts[0].responseStatus == 429 with responseHeaders["retry-after"] == "2"',
      'attempts[1].responseStatus == 200 (succeeded after backoff)',
    ],
  },
};

export default scenario;
