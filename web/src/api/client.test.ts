import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, EmptyResponseError, apiClient } from './client';

// The typed fetch wrapper turns the server's contract into thrown ApiErrors: non-2xx surfaces the
// error envelope, and a 2xx with no body is itself a contract violation (every typed endpoint
// returns JSON) rather than a silently-cast `undefined`.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request (via apiClient)', () => {
  it('parses and returns the JSON body on a 2xx', async () => {
    const events = [{ id: 'evt_1' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(events)));
    await expect(apiClient.listEvents()).resolves.toEqual(events);
  });

  it('throws a distinct EmptyResponseError (not ApiError) on a 204/No Content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    // A client/server contract violation on a 2xx status — must NOT masquerade as a server ApiError.
    await expect(apiClient.listEvents()).rejects.toBeInstanceOf(EmptyResponseError);
    await expect(apiClient.listEvents()).rejects.not.toBeInstanceOf(ApiError);
    await expect(apiClient.listEvents()).rejects.toMatchObject({
      name: 'EmptyResponseError',
      status: 204,
      path: '/events',
    });
  });

  it('throws ApiError carrying the server error envelope on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'NotFound' }, 404)));
    await expect(apiClient.getEvent('missing')).rejects.toMatchObject({
      status: 404,
      code: 'NotFound',
    });
  });

  it('falls back to statusText when a non-2xx body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 })),
    );
    await expect(apiClient.listEvents()).rejects.toBeInstanceOf(ApiError);
  });
});
