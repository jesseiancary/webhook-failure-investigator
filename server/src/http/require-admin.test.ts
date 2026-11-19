import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireAdmin } from './require-admin.js';

// ADMIN_API_TOKEN is read lazily by env, so each case sets/clears it on process.env.

afterEach(() => {
  delete process.env.ADMIN_API_TOKEN;
});

/** A minimal Express Response capturing the status + JSON body the middleware writes. */
function mockRes(): Response & { captured: { status: number; body: unknown } } {
  const captured = { status: 200, body: undefined as unknown };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
    captured,
  };
  return res as unknown as Response & { captured: typeof captured };
}

function run(headers: Record<string, string>): {
  res: ReturnType<typeof mockRes>;
  next: NextFunction;
} {
  const res = mockRes();
  const next = vi.fn();
  requireAdmin({ headers } as unknown as Request, res, next);
  return { res, next };
}

describe('requireAdmin', () => {
  it('no-ops (calls next) when ADMIN_API_TOKEN is unset — local dev / tests stay open', () => {
    const { res, next } = run({});
    expect(next).toHaveBeenCalledOnce();
    expect(res.captured.status).toBe(200);
  });

  it('401s in the standard envelope when the token is set but no bearer header is sent', () => {
    process.env.ADMIN_API_TOKEN = 'a-very-secret-admin-token-value';
    const { res, next } = run({});
    expect(next).not.toHaveBeenCalled();
    expect(res.captured.status).toBe(401);
    expect(res.captured.body).toEqual({ error: 'Unauthorized' });
  });

  it('401s on a wrong bearer token', () => {
    process.env.ADMIN_API_TOKEN = 'a-very-secret-admin-token-value';
    const { res, next } = run({ authorization: 'Bearer not-the-token' });
    expect(next).not.toHaveBeenCalled();
    expect(res.captured.status).toBe(401);
  });

  it('calls next when the correct bearer token is supplied', () => {
    process.env.ADMIN_API_TOKEN = 'a-very-secret-admin-token-value';
    const { res, next } = run({ authorization: 'Bearer a-very-secret-admin-token-value' });
    expect(next).toHaveBeenCalledOnce();
    expect(res.captured.status).toBe(200);
  });
});
