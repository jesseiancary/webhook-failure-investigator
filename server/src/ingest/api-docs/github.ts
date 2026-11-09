import type { ApiDocEntry } from './types.js';

// GitHub webhook reference docs. Public, secret-free facts grounding the GitHub scenarios
// (HMAC signature validation, auth/permission errors, rate limiting, delivery timeouts).
const docs: ApiDocEntry[] = [
  {
    id: 'doc_github_signature_validation',
    provider: 'github',
    section: 'Webhook signature validation',
    content:
      'GitHub signs webhook deliveries with the X-Hub-Signature-256 header, an HMAC-SHA256 of the ' +
      'raw request body keyed by the secret configured on the webhook. The receiver recomputes the ' +
      'digest and compares it in constant time; a mismatch means the secret is wrong or the body was ' +
      'modified in transit, and should be rejected with HTTP 400. The X-GitHub-Event header names the ' +
      'event type and X-GitHub-Delivery carries a unique delivery id for correlation.',
  },
  {
    id: 'doc_github_authentication',
    provider: 'github',
    section: 'Authentication and permissions',
    content:
      'GitHub API requests made with a missing, expired, or revoked token return HTTP 401 ' +
      'Unauthorized; requests whose token lacks the required scope or whose app lacks permission ' +
      'return HTTP 403 Forbidden. Fix a 401 by refreshing the credential and a 403 by granting the ' +
      'required scope or installation permission — neither is a payload issue.',
  },
  {
    id: 'doc_github_rate_limiting',
    provider: 'github',
    section: 'Rate limiting',
    content:
      'When an integration exceeds its limit, GitHub responds with HTTP 429 Too Many Requests or a ' +
      '403 with a rate-limit message, plus Retry-After and the X-RateLimit-Remaining / ' +
      'X-RateLimit-Reset headers. Respect Retry-After and resume after the reset window; a ' +
      'rate-limit rejection is throttling, distinct from an authentication failure.',
  },
  {
    id: 'doc_github_delivery_timeouts',
    provider: 'github',
    section: 'Delivery timeouts',
    content:
      'GitHub expects a webhook receiver to respond within 10 seconds. If the endpoint does not ' +
      'respond in time the delivery is recorded as timed out, often with no response status at all. ' +
      'A timeout points at a slow or blocked handler, not at the credentials or the payload: ack the ' +
      'webhook quickly and move slow work to a background job.',
  },
];

export default docs;
