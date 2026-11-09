import type { ApiDocEntry } from './types.js';

// Stripe webhook reference docs. Public, secret-free facts that ground explanations/remediation for
// the Stripe scenarios (signature verification, expired keys, retries/rate limits, payload shape).
const docs: ApiDocEntry[] = [
  {
    id: 'doc_stripe_signature_verification',
    provider: 'stripe',
    section: 'Signature verification',
    content:
      'Stripe signs every webhook with the Stripe-Signature header, which carries a timestamp (t=) ' +
      'and one or more HMAC-SHA256 signatures (v1=) computed over "timestamp.payload" using your ' +
      "endpoint's signing secret. Recompute the signature and compare; a mismatch means the payload " +
      'was altered, the wrong signing secret was used, or the body was re-serialized. Reject an ' +
      'invalid signature with HTTP 400. Also reject timestamps outside your tolerance (default 5 ' +
      'minutes) to prevent replay. A signature failure is an authentication/validation problem, not ' +
      'a network problem.',
  },
  {
    id: 'doc_stripe_authentication',
    provider: 'stripe',
    section: 'Authentication and API keys',
    content:
      'When a request to the Stripe API uses an expired, revoked, or malformed key, Stripe responds ' +
      '401 Unauthorized with an error object whose code is api_key_expired or whose type is ' +
      'invalid_request_error, and may include a WWW-Authenticate header. Rotate the key in the ' +
      'Dashboard, deploy the new value, and retry. A 401 is about credentials, so it is never fixed ' +
      'by changing the payload.',
  },
  {
    id: 'doc_stripe_retries_rate_limits',
    provider: 'stripe',
    section: 'Delivery retries and rate limits',
    content:
      'Stripe automatically retries failed webhook deliveries with exponential backoff for up to ' +
      'three days. API requests that exceed Stripe rate limits return HTTP 429 with a Retry-After ' +
      'header indicating how long to wait. Treat a 429 as throttling: back off and retry after the ' +
      'indicated delay rather than hammering the endpoint.',
  },
  {
    id: 'doc_stripe_event_payload',
    provider: 'stripe',
    section: 'Event payload structure',
    content:
      'A Stripe event is a JSON object with a top-level id, a type such as invoice.payment_failed, ' +
      'and a data.object holding the affected resource. Receivers that reject a webhook as malformed ' +
      'typically return HTTP 400 with a message naming the missing or invalid field. Compare the ' +
      'rejected body against the documented event shape to find the discrepancy.',
  },
];

export default docs;
