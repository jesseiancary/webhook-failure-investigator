import type { Scenario } from './types.js';

// The HTTP exchange "succeeded" (200), yet the webhook had no effect: the receiver recognized a
// duplicate event and ignored it. The failure is in application logic, not transport — the only
// signal is in the 200 response body, which is exactly why 2xx cases are easy to misdiagnose.
const scenario: Scenario = {
  key: 'seed_stripe_app_logic_idempotent',
  description: 'Stripe delivery returned 200 but was ignored as a duplicate (idempotency).',
  submission: {
    source: 'stripe',
    eventType: 'checkout.session.completed',
    payload: {
      id: 'evt_1Pg0A',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_a1', payment_status: 'paid' } },
    },
    headers: {
      'stripe-signature': '[REDACTED]',
      'idempotency-key': 'evt_1Pg0A',
      'content-type': 'application/json',
    },
    attempts: [
      {
        requestUrl: 'https://hooks.acme-app.com/webhooks/stripe',
        requestMethod: 'POST',
        requestHeaders: {
          'content-type': 'application/json',
          'stripe-signature': '[REDACTED]',
          'idempotency-key': 'evt_1Pg0A',
        },
        requestBody: { id: 'evt_1Pg0A', type: 'checkout.session.completed' },
        responseStatus: 200,
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: {
          received: true,
          status: 'ignored',
          reason: 'duplicate_event',
          idempotency_key: 'evt_1Pg0A',
        },
        latencyMs: 88,
      },
    ],
  },
  expected: {
    category: 'application_logic',
    evidence: [
      'attempts[0].responseStatus == 200 (transport succeeded)',
      'attempts[0].responseBody.status == "ignored"',
      'attempts[0].responseBody.reason == "duplicate_event"',
    ],
  },
};

export default scenario;
