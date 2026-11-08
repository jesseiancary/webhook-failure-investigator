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
