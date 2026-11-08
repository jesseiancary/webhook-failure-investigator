import type { Scenario } from './types.js';

// GitHub delivery throttled 429 — the receiver is rate limiting. Grounded in the 429 status plus the
// Retry-After and X-RateLimit-* headers that say exactly how long to back off.
const scenario: Scenario = {
  key: 'seed_github_rate_limit_429',
  description: 'GitHub delivery throttled 429 — Retry-After + X-RateLimit-Remaining: 0.',
  submission: {
    source: 'github',
    eventType: 'issues',
    payload: { action: 'labeled', issue: { number: 7 }, repository: { full_name: 'acme/widgets' } },
    headers: {
      'x-github-event': 'issues',
      'x-github-delivery': '8e6c9042-5a1d-11ef-8e2d-0242ac110004',
      'x-hub-signature-256': '[REDACTED]',
      'content-type': 'application/json',
    },
    attempts: [
      {
        requestUrl: 'https://hooks.acme-app.com/webhooks/github',
        requestMethod: 'POST',
        requestHeaders: {
          'content-type': 'application/json',
          'x-github-event': 'issues',
          'x-hub-signature-256': '[REDACTED]',
        },
        requestBody: { action: 'labeled', issue: { number: 7 } },
        responseStatus: 429,
        responseHeaders: {
          'content-type': 'application/json',
          'retry-after': '30',
          'x-ratelimit-limit': '100',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1731000030',
        },
        responseBody: { error: 'rate_limited', message: 'Too many requests, retry after 30s' },
        latencyMs: 63,
      },
    ],
  },
  expected: {
    category: 'rate_limit',
    evidence: [
      'attempts[0].responseStatus == 429',
      'attempts[0].responseHeaders["retry-after"] == "30"',
      'attempts[0].responseHeaders["x-ratelimit-remaining"] == "0"',
    ],
  },
};

export default scenario;
