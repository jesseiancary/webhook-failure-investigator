import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from './error-handler.js';

// A minimal Response double capturing status()/json() calls.
function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const req = {} as Request;
const next = (() => undefined) as unknown as NextFunction;

describe('errorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces a body-parser 400 (malformed JSON) without logging it as a fault', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = mockRes();
    const err = Object.assign(new SyntaxError('Unexpected token'), { status: 400 });

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'BadRequest' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('surfaces a 413 payload-too-large', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = mockRes();
    const err = Object.assign(new Error('too large'), { statusCode: 413 });

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: 'PayloadTooLarge' });
  });

  it('treats an unknown error as a logged 500', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = mockRes();

    errorHandler(new Error('boom'), req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'InternalServerError' });
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('does not treat a 5xx status as a client error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = mockRes();
    const err = Object.assign(new Error('upstream'), { status: 502 });

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'InternalServerError' });
  });
});
