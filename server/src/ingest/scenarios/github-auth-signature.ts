import type { Scenario } from './types.js';

// GitHub webhook rejected 401 because HMAC signature verification failed (wrong/rotated secret).
// Grounded in the presence of X-Hub-Signature-256 on the request and the 401 + message on the response.
const scenario: Scenario = {
  key: 'seed_github_auth_signature',
  description: 'GitHub delivery rejected 401 — X-Hub-Signature-256 verification failed.',
  submission: {
    source: 'github',
    eventType: 'push',
    payload: {
      ref: 'refs/heads/main',
      repository: { full_name: 'acme/widgets' },
      pusher: { name: 'octocat' },
    },
    headers: {
      'x-github-event': 'push',
      'x-github-delivery': '6c4a7e2e-5a1b-11ef-9c1a-0242ac110002',
      'x-hub-signature-256': '[REDACTED]',
      'user-agent': 'GitHub-Hookshot/abc123',
      'content-type': 'application/json',
    },
    attempts: [
      {
        requestUrl: 'https://hooks.acme-app.com/webhooks/github',
        requestMethod: 'POST',
        requestHeaders: {
          'content-type': 'application/json',
          'x-github-event': 'push',
          'x-hub-signature-256': '[REDACTED]',
        },
        requestBody: { ref: 'refs/heads/main', repository: { full_name: 'acme/widgets' } },
        responseStatus: 401,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: { message: 'Webhook signature verification failed' },
        latencyMs: 54,
      },
    ],
  },
  expected: {
    category: 'authentication',
    evidence: [
      'attempts[0].requestHeaders["x-hub-signature-256"] present',
      'attempts[0].responseStatus == 401',
      'attempts[0].responseBody.message == "Webhook signature verification failed"',
    ],
  },
};

export default scenario;
