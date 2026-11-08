import type { Scenario } from './types.js';

// Payload-validation failure whose request body carries a secret (`client_secret`). Authored with a
// fake, guard-safe value; createEvent redacts it to [REDACTED] on load, so the stored event proves
// the choke point works on seeded data too. The diagnosis still grounds in the 400 response.
const scenario: Scenario = {
  key: 'seed_slack_payload_secret_redacted',
  description: 'Slack OAuth exchange rejected 400 — body client_secret is redacted on load.',
  submission: {
    source: 'slack',
    eventType: 'app_oauth_exchange',
    payload: {
      type: 'app_oauth_exchange',
      team_id: 'T024BE7LD',
      // Fake, non-secret-looking value on purpose; the redactor strips it by key on write.
      client_secret: 'shh-not-real',
    },
    headers: {
      'x-slack-signature': '[REDACTED]',
      'x-slack-request-timestamp': '1731000200',
      'content-type': 'application/json',
    },
    attempts: [
      {
        requestUrl: 'https://hooks.acme-app.com/webhooks/slack',
        requestMethod: 'POST',
        requestHeaders: {
          'content-type': 'application/json',
          'x-slack-signature': '[REDACTED]',
          'x-slack-request-timestamp': '1731000200',
        },
        requestBody: {
          type: 'app_oauth_exchange',
          team_id: 'T024BE7LD',
          client_secret: 'shh-not-real',
          code: 'valid-but-expired',
        },
        responseStatus: 400,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: {
          ok: false,
          error: 'invalid_code',
          detail: 'authorization code has expired',
        },
        latencyMs: 49,
      },
    ],
  },
  expected: {
    category: 'payload_validation',
    evidence: [
      'attempts[0].responseStatus == 400',
      'attempts[0].responseBody.error == "invalid_code"',
      'attempts[0].responseBody.detail == "authorization code has expired"',
    ],
  },
};

export default scenario;
