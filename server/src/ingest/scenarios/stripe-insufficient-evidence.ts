import type { Scenario } from './types.js';

// The logs are too thin to ground a cause: the connection dropped with a bare "socket hang up" and
// no response status, headers, or body. That's ambiguous between timeout, a network fault, and the
// receiver crashing mid-response — the correct answer is to refuse to guess (insufficient_evidence).
const scenario: Scenario = {
  key: 'seed_stripe_insufficient_evidence',
  description: 'Stripe delivery dropped with a bare "socket hang up" — too little to classify.',
  submission: {
    source: 'stripe',
    eventType: 'customer.updated',
    payload: { id: 'evt_1Pg7Q', type: 'customer.updated', data: { object: { id: 'cus_Abc' } } },
    headers: {
      'stripe-signature': '[REDACTED]',
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
        requestBody: { id: 'evt_1Pg7Q', type: 'customer.updated' },
        errorText: 'socket hang up',
      },
    ],
  },
  expected: {
    category: 'insufficient_evidence',
    evidence: [
      'attempts[0].errorText == "socket hang up" (ambiguous drop)',
      'attempts[0] has no responseStatus, responseHeaders, responseBody, or latencyMs to classify the cause',
    ],
  },
};

export default scenario;
