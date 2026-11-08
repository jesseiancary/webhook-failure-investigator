import type { Scenario } from './types.js';

// Stripe webhook rejected by the receiver with 401 because the API key used to authenticate the
// delivery had expired. The cause is in the response: 401 + WWW-Authenticate + the Stripe error code.
const scenario: Scenario = {
  key: 'seed_stripe_auth_401',
  description:
    'Stripe delivery rejected 401 — expired API key (WWW-Authenticate + api_key_expired).',
  submission: {
    source: 'stripe',
    eventType: 'invoice.payment_failed',
    payload: {
      id: 'evt_1Pf2A',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1Pabc', amount_due: 4200, currency: 'usd' } },
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
          authorization: '[REDACTED]',
          'stripe-signature': '[REDACTED]',
        },
        requestBody: {
          id: 'evt_1Pf2A',
          type: 'invoice.payment_failed',
          data: { object: { id: 'in_1Pabc', amount_due: 4200 } },
        },
        responseStatus: 401,
        responseHeaders: {
          'content-type': 'application/json',
          'www-authenticate': 'Bearer realm="api", error="invalid_token"',
        },
        responseBody: {
          error: {
            type: 'invalid_request_error',
            code: 'api_key_expired',
            message: 'Expired API key provided.',
          },
        },
        latencyMs: 118,
      },
    ],
  },
  expected: {
    category: 'authentication',
    evidence: [
      'attempts[0].responseStatus == 401',
      'attempts[0].responseHeaders["www-authenticate"]',
      'attempts[0].responseBody.error.code == "api_key_expired"',
    ],
  },
};

export default scenario;
