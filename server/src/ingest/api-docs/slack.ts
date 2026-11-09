import type { ApiDocEntry } from './types.js';

// Slack webhook/Events API reference docs. Public, secret-free facts grounding the Slack scenarios
// (request signing, event payload validation, error-body shape, rate limits).
const docs: ApiDocEntry[] = [
  {
    id: 'doc_slack_request_signing',
    provider: 'slack',
    section: 'Request signing',
    content:
      'Slack signs each request with X-Slack-Signature (a v0 HMAC-SHA256 over ' +
      '"v0:timestamp:body" keyed by your signing secret) and X-Slack-Request-Timestamp. The ' +
      'receiver recomputes the signature and compares it, and rejects requests whose timestamp is ' +
      'more than five minutes old to block replay. A signature mismatch is an authentication ' +
      'failure, typically answered with HTTP 400 or 401.',
  },
  {
    id: 'doc_slack_event_payload',
    provider: 'slack',
    section: 'Event payload validation',
    content:
      'An Events API delivery of type event_callback must include a top-level event object alongside ' +
      'team_id and the outer type. A url_verification request instead carries a challenge the ' +
      'receiver must echo back. Receivers reject a malformed delivery with HTTP 400 and a body like ' +
      '{ ok: false, error: "invalid_payload" }, frequently naming the missing field (for example, a ' +
      'missing required "event").',
  },
  {
    id: 'doc_slack_error_responses',
    provider: 'slack',
    section: 'Error response format',
    content:
      'Slack API and Events responses use a JSON envelope with an ok boolean. On failure ok is false ' +
      'and an error string names the reason (invalid_payload, invalid_auth, not_authed, ' +
      'ratelimited). A 2xx status with ok:false is an application-logic rejection, not a transport ' +
      'failure: read the error string rather than the HTTP status alone.',
  },
  {
    id: 'doc_slack_rate_limits',
    provider: 'slack',
    section: 'Rate limits',
    content:
      'When a workspace exceeds Slack rate limits the API returns HTTP 429 with a Retry-After header ' +
      'and, for Web API calls, an error of ratelimited. Back off for the indicated number of seconds ' +
      'before retrying; a 429 is throttling and resolves on its own once traffic drops.',
  },
];

export default docs;
