import { describe, expect, it } from 'vitest';
import { REDACTED, redactHeaders, redactJson } from './redact.js';

describe('redactHeaders', () => {
  it('redacts the Authorization header', () => {
    expect(redactHeaders({ Authorization: 'Bearer sk-live-abc123' })).toEqual({
      Authorization: REDACTED,
    });
  });

  it('matches header names case-insensitively', () => {
    expect(redactHeaders({ AUTHORIZATION: 'x', authorization: 'y' })).toEqual({
      AUTHORIZATION: REDACTED,
      authorization: REDACTED,
    });
  });

  it('redacts cookies, api keys, and webhook secrets', () => {
    const redacted = redactHeaders({
      Cookie: 'session=abc',
      'X-Api-Key': 'key_123',
      'X-Webhook-Secret': 'whsec_123',
    });
    expect(redacted).toEqual({
      Cookie: REDACTED,
      'X-Api-Key': REDACTED,
      'X-Webhook-Secret': REDACTED,
    });
  });

  it('redacts provider signature headers via pattern', () => {
    const redacted = redactHeaders({
      'Stripe-Signature': 't=1,v1=abc',
      'X-Hub-Signature-256': 'sha256=abc',
      'X-Slack-Signature': 'v0=abc',
    });
    expect(redacted).toEqual({
      'Stripe-Signature': REDACTED,
      'X-Hub-Signature-256': REDACTED,
      'X-Slack-Signature': REDACTED,
    });
  });

  it('redacts an array-valued header (Set-Cookie) wholesale', () => {
    expect(redactHeaders({ 'Set-Cookie': ['a=1', 'b=2'] })).toEqual({
      'Set-Cookie': REDACTED,
    });
  });

  it('preserves non-secret headers', () => {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Stripe/1.0',
      'X-Request-Id': 'req_123',
    };
    expect(redactHeaders(headers)).toEqual(headers);
  });

  it('redacts a credential-shaped value under an innocuous header name', () => {
    expect(
      redactHeaders({
        'X-Custom': 'whsec_0123456789abcdef',
        'X-Trace': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123',
      }),
    ).toEqual({ 'X-Custom': REDACTED, 'X-Trace': REDACTED });
  });

  it('redacts an array-valued header when any element looks like a credential', () => {
    expect(redactHeaders({ 'X-Multi': ['ok', 'sk-proj-ABCDEFGHIJKLMNOP1234'] })).toEqual({
      'X-Multi': REDACTED,
    });
  });

  it('does not mutate the input', () => {
    const input = { Authorization: 'Bearer x' };
    redactHeaders(input);
    expect(input).toEqual({ Authorization: 'Bearer x' });
  });

  it('is idempotent', () => {
    const once = redactHeaders({ Authorization: 'Bearer x', 'Content-Type': 'json' });
    expect(redactHeaders(once)).toEqual(once);
  });
});

describe('redactJson', () => {
  it('redacts top-level secret fields', () => {
    expect(redactJson({ password: 'hunter2', username: 'alice' })).toEqual({
      password: REDACTED,
      username: 'alice',
    });
  });

  it('matches keys case-insensitively', () => {
    expect(redactJson({ Access_Token: 'abc', API_KEY: 'def' })).toEqual({
      Access_Token: REDACTED,
      API_KEY: REDACTED,
    });
  });

  it('redacts nested secret fields', () => {
    expect(redactJson({ user: { name: 'bob', client_secret: 'cs_123' } })).toEqual({
      user: { name: 'bob', client_secret: REDACTED },
    });
  });

  it('redacts secrets inside arrays of objects', () => {
    expect(redactJson({ creds: [{ token: 't1' }, { token: 't2' }] })).toEqual({
      creds: [{ token: REDACTED }, { token: REDACTED }],
    });
  });

  it('uses exact-key matching so evidence fields are preserved', () => {
    // `tokenCount` / `signatureValid` merely contain a denylisted word — not secrets.
    expect(redactJson({ tokenCount: 3, signatureValid: true })).toEqual({
      tokenCount: 3,
      signatureValid: true,
    });
  });

  it('redacts a credential-shaped value under a non-denylisted key', () => {
    // The key name is unknown to the denylist; the VALUE shape is what triggers redaction.
    expect(
      redactJson({
        charge_token: 'sk-live-ABCDEFGHIJKLMNOP1234',
        webhook_signing_key: 'whsec_0123456789abcdef',
        xAuth: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcDEF123456',
      }),
    ).toEqual({ charge_token: REDACTED, webhook_signing_key: REDACTED, xAuth: REDACTED });
  });

  it('redacts credential-shaped values nested in objects and arrays', () => {
    expect(
      redactJson({
        meta: { trace: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' },
        keys: ['xoxb-abc-123def'],
      }),
    ).toEqual({ meta: { trace: REDACTED }, keys: [REDACTED] });
  });

  it('preserves random-looking IDs that are legitimate evidence (no entropy scoring)', () => {
    // Event / request / idempotency IDs look random but are NOT credentials — redacting them
    // would starve the grounded diagnosis. Value matching is prefix/shape-based, not entropy.
    const evidence = {
      event_id: 'evt_1Qx8Zk2eZvKYlo2C0aBcDeFg',
      request_id: 'req_7f3a9c2b4d5e6f70',
      idempotency_key: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      amount: 4200,
    };
    expect(redactJson(evidence)).toEqual(evidence);
  });

  it('passes non-object values through unchanged', () => {
    expect(redactJson('hello')).toBe('hello');
    expect(redactJson(42)).toBe(42);
    expect(redactJson(null)).toBeNull();
    expect(redactJson(undefined)).toBeUndefined();
  });

  it('does not mutate the input', () => {
    const input = { password: 'x', nested: { token: 'y' } };
    redactJson(input);
    expect(input).toEqual({ password: 'x', nested: { token: 'y' } });
  });

  it('is idempotent', () => {
    const once = redactJson({ password: 'x', keep: 'me', nested: { api_key: 'k' } });
    expect(redactJson(once)).toEqual(once);
  });
});
