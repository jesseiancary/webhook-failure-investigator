import type { Scenario } from './types.js';

// Stripe delivery that failed at the network layer — DNS resolution failed, so no connection was
// ever made. No response; the cause is the ENOTFOUND error text for the destination host.
const scenario: Scenario = {
  key: 'seed_stripe_network_dns',
  description: 'Stripe delivery failed to connect — DNS ENOTFOUND for the destination host.',
  submission: {
    source: 'stripe',
    eventType: 'charge.succeeded',
    payload: {
      id: 'evt_1Pf9Z',
      type: 'charge.succeeded',
      data: { object: { id: 'ch_1Pxyz', amount: 1999, currency: 'usd' } },
    },
    headers: {
      'stripe-signature': '[REDACTED]',
      'user-agent': 'Stripe/1.0 (+https://stripe.com/docs/webhooks)',
      'content-type': 'application/json',
    },
    attempts: [
      {
        requestUrl: 'https://hooks.acme-app.com/webhooks/stripe',
        requestMethod: 'POST',
        requestHeaders: {
          'content-type': 'application/json',
          'stripe-signature': '[REDACTED]',
        },
        requestBody: { id: 'evt_1Pf9Z', type: 'charge.succeeded' },
        latencyMs: 27,
        errorText: 'getaddrinfo ENOTFOUND hooks.acme-app.com',
      },
    ],
  },
  expected: {
    category: 'network_failure',
    evidence: [
      'attempts[0].errorText contains "ENOTFOUND" (DNS resolution failed)',
      'attempts[0] has no responseStatus (connection never established)',
    ],
  },
};

export default scenario;
