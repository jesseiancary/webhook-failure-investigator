import { describe, expect, it } from 'vitest';
import { generateCaptureToken, inferSourceAndType, toHeaderMap } from './capture.service.js';

// DB-free unit tests for the pure capture helpers. The persistence path is exercised by
// capture.routes.int.test.ts against a real database.

describe('generateCaptureToken', () => {
  it('produces distinct, URL-safe, high-entropy tokens', () => {
    const tokens = Array.from({ length: 100 }, generateCaptureToken);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, safe in a URL path
      expect(token.length).toBeGreaterThanOrEqual(32); // 24 bytes -> 32 base64url chars
    }
    expect(new Set(tokens).size).toBe(tokens.length); // no collisions
  });
});

describe('inferSourceAndType', () => {
  it('identifies Stripe from its signature header and the body type', () => {
    const result = inferSourceAndType(
      { 'Stripe-Signature': 't=1,v1=deadbeef' },
      { type: 'invoice.payment_failed' },
    );
    expect(result).toEqual({ source: 'stripe', eventType: 'invoice.payment_failed' });
  });

  it('identifies GitHub and reads the event type from its header', () => {
    const result = inferSourceAndType({ 'X-GitHub-Event': 'push' }, { action: 'opened' });
    expect(result).toEqual({ source: 'github', eventType: 'push' });
  });

  it('identifies Slack and reads the event type from the body `event` field', () => {
    const result = inferSourceAndType({ 'X-Slack-Signature': 'v0=abc' }, { event: 'app_mention' });
    expect(result).toEqual({ source: 'slack', eventType: 'app_mention' });
  });

  it('falls back to the endpoint source and `unknown` event type', () => {
    expect(inferSourceAndType({}, {}, 'custom')).toEqual({
      source: 'custom',
      eventType: 'unknown',
    });
    expect(inferSourceAndType({}, null)).toEqual({ source: 'unknown', eventType: 'unknown' });
  });

  it('matches header names case-insensitively and lets provider signals win over the default', () => {
    const result = inferSourceAndType(
      { 'stripe-signature': 't=1' },
      { type: 'charge.failed' },
      'github',
    );
    expect(result).toEqual({ source: 'stripe', eventType: 'charge.failed' });
  });
});

describe('toHeaderMap', () => {
  it('drops undefined-valued headers and keeps string and array values', () => {
    expect(toHeaderMap({ a: 'x', b: undefined, c: ['1', '2'] })).toEqual({ a: 'x', c: ['1', '2'] });
  });
});
