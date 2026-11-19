import type { NextFunction, Request, Response } from 'express';
import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DailyBudgetExceededError } from '../diagnosis/cost-guard.js';
import { logger } from '../logging/logger.js';
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
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const res = mockRes();
    const err = Object.assign(new SyntaxError('Unexpected token'), { status: 400 });

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'BadRequest' });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('surfaces a 413 payload-too-large', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const res = mockRes();
    const err = Object.assign(new Error('too large'), { statusCode: 413 });

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: 'PayloadTooLarge' });
  });

  it('treats an unknown error as a logged 500', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const res = mockRes();

    errorHandler(new Error('boom'), req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'InternalServerError' });
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('does not treat a 5xx status as a client error', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const res = mockRes();
    const err = Object.assign(new Error('upstream'), { status: 502 });

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'InternalServerError' });
  });

  it('maps an OpenAI APIError to a 502 upstream error, not a client BadRequest', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const res = mockRes();
    // A 401 from a bad OPENAI_API_KEY: its 4xx status must NOT leak through as `BadRequest`.
    const err = new OpenAI.APIError(
      401,
      { type: 'invalid_request_error', code: 'invalid_api_key' },
      'Incorrect API key provided',
      undefined,
    );

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({
      error: 'UpstreamServiceError',
      message: 'The diagnosis service is temporarily unavailable. Please try again shortly.',
    });
    // It is a genuine upstream fault — logged — but the error's message is never echoed to the client.
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('renders a DailyBudgetExceededError as a friendly 429 with a verbatim message (not a fault)', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const res = mockRes();
    const err = new DailyBudgetExceededError(2.5, 2);

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'DailyBudgetReached', message: err.message });
    // It is an expected demo condition, not a server fault — nothing is logged at error level.
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
