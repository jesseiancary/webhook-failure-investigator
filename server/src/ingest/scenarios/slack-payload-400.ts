import type { Scenario } from './types.js';

// Slack Events API delivery rejected 400 — the receiver validated the payload and found a required
// field missing. Grounded in the 400 status and the error body, not the request auth.
const scenario: Scenario = {
  key: 'seed_slack_payload_400',
  description: 'Slack delivery rejected 400 — invalid_payload, missing required "event" field.',
  submission: {
    source: 'slack',
    eventType: 'event_callback',
    payload: {
      token: '[REDACTED]',
      team_id: 'T024BE7LD',
      type: 'event_callback',
      api_app_id: 'A0KRD7HC',
    },
    headers: {
      'x-slack-signature': '[REDACTED]',
      'x-slack-request-timestamp': '1731000000',
      'content-type': 'application/json',
    },
    attempts: [
      {
        requestUrl: 'https://hooks.acme-app.com/webhooks/slack',
        requestMethod: 'POST',
        requestHeaders: {
          'content-type': 'application/json',
          'x-slack-signature': '[REDACTED]',
          'x-slack-request-timestamp': '1731000000',
        },
        requestBody: { team_id: 'T024BE7LD', type: 'event_callback', api_app_id: 'A0KRD7HC' },
        responseStatus: 400,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: {
          ok: false,
          error: 'invalid_payload',
          detail: 'missing required field: event',
        },
        latencyMs: 41,
      },
    ],
  },
  expected: {
    category: 'payload_validation',
    evidence: [
      'attempts[0].responseStatus == 400',
      'attempts[0].responseBody.error == "invalid_payload"',
      'attempts[0].responseBody.detail names the missing field "event"',
    ],
  },
};

export default scenario;
