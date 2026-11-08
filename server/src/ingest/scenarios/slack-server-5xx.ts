import type { Scenario } from './types.js';

// Slack delivery failed 503 — the receiver itself is unhealthy. A retryable server-side fault:
// the request was well-formed and authenticated, but the destination returned a 5xx.
const scenario: Scenario = {
  key: 'seed_slack_server_5xx',
  description: 'Slack delivery failed 503 — receiver returned Service Unavailable.',
  submission: {
    source: 'slack',
    eventType: 'event_callback',
    payload: {
      team_id: 'T024BE7LD',
      type: 'event_callback',
      event: { type: 'message', text: 'hello' },
    },
    headers: {
      'x-slack-signature': '[REDACTED]',
      'x-slack-request-timestamp': '1731000100',
      'content-type': 'application/json',
    },
    attempts: [
      {
        requestUrl: 'https://hooks.acme-app.com/webhooks/slack',
        requestMethod: 'POST',
        requestHeaders: {
          'content-type': 'application/json',
          'x-slack-signature': '[REDACTED]',
          'x-slack-request-timestamp': '1731000100',
        },
        requestBody: { team_id: 'T024BE7LD', type: 'event_callback', event: { type: 'message' } },
        responseStatus: 503,
        responseHeaders: { 'content-type': 'text/html', 'retry-after': '5' },
        responseBody: '<html><body><h1>503 Service Unavailable</h1></body></html>',
        latencyMs: 2043,
      },
    ],
  },
  expected: {
    category: 'server_error',
    evidence: [
      'attempts[0].responseStatus == 503',
      'attempts[0].responseBody says "Service Unavailable"',
    ],
  },
};

export default scenario;
