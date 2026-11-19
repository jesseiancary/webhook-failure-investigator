import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { redactPaths } from './logger.js';

// The security guarantee B8 asserts: request-header logging can never emit auth material. Build a pino
// logger with the same redact config as the shared logger, writing to a capture buffer, and confirm
// the denylisted headers are censored on a serialized request object.

describe('logger header redaction', () => {
  it('censors auth-bearing request headers instead of emitting their values', () => {
    const lines: string[] = [];
    const log = pino(
      { redact: { paths: redactPaths(), censor: '[REDACTED]' } },
      { write: (chunk: string) => lines.push(chunk) },
    );

    log.info(
      {
        req: {
          headers: {
            authorization: 'Bearer super-secret-token',
            cookie: 'sid=abc123',
            'x-api-key': 'key-should-not-leak',
            'x-webhook-secret': 'whsec-must-not-leak',
            'content-type': 'application/json',
          },
        },
      },
      'incoming request',
    );

    const output = lines.join('');
    expect(output).not.toContain('super-secret-token');
    expect(output).not.toContain('sid=abc123');
    expect(output).not.toContain('key-should-not-leak');
    expect(output).not.toContain('whsec-must-not-leak');
    expect(output).toContain('[REDACTED]');
    // A non-secret header is left intact — redaction is targeted, not blanket.
    expect(output).toContain('application/json');
  });
});
