import { describe, expect, it } from 'vitest';
import { API_ROUTES, apiProxyKey, isProxiedApiPath } from './api-proxy';

// The dev proxy forwards exactly the server's API paths and nothing that merely shares a prefix.
// This pins that contract so a future route-list or matcher change can't silently stop proxying a
// real endpoint (as an earlier bare-`^/capture(/|$)` regex did to `/capture-endpoints`) or start
// capturing a sibling SPA route.

describe('apiProxyKey', () => {
  it('anchors the route and matches it exactly or as a path prefix', () => {
    const re = new RegExp(apiProxyKey('/events'));
    expect(re.test('/events')).toBe(true);
    expect(re.test('/events/evt_123')).toBe(true);
    expect(re.test('/events/evt_123/investigate')).toBe(true);
  });

  it('matches the route with a query string (Vite tests the key against req.url, query included)', () => {
    const re = new RegExp(apiProxyKey('/events'));
    expect(re.test('/events?limit=10')).toBe(true);
    expect(re.test('/events/evt_123?expand=diagnosis')).toBe(true);
  });

  it('does not match a sibling route that only shares a string prefix', () => {
    const re = new RegExp(apiProxyKey('/events'));
    expect(re.test('/events-archive')).toBe(false);
    // The `?` boundary must not loosen the prefix guard: a query on a sibling still must not match.
    expect(re.test('/events-archive?x=1')).toBe(false);
    // `^/capture([/?]|$)` must not swallow the distinct `/capture-endpoints` route.
    expect(new RegExp(apiProxyKey('/capture')).test('/capture-endpoints')).toBe(false);
  });
});

describe('isProxiedApiPath', () => {
  it.each([
    '/events',
    '/events/evt_123',
    '/events/evt_123/investigate',
    '/events?limit=10',
    '/investigations/inv_1',
    '/capture/tok_abc',
    '/capture/tok_abc?x=1',
    '/capture-endpoints',
    '/capture-endpoints/ep_1',
    '/health',
  ])('proxies the real API path %s', (path) => {
    expect(isProxiedApiPath(path)).toBe(true);
  });

  it.each([
    '/',
    '/dashboard',
    '/submit',
    '/events-archive',
    '/events-archive?x=1',
    '/captured',
    '/healthz',
  ])('does not proxy the SPA/non-API path %s', (path) => {
    expect(isProxiedApiPath(path)).toBe(false);
  });

  it('keeps /capture and /capture-endpoints as independent entries', () => {
    expect(API_ROUTES).toContain('/capture');
    expect(API_ROUTES).toContain('/capture-endpoints');
  });
});
