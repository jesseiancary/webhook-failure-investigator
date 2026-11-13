import { describe, expect, it } from 'vitest';
import { type SubmissionForm, emptyAttempt, validateSubmission } from './submission';

// Local, fast-feedback validation for the submit form. The server's Zod schema stays authoritative
// on POST; these tests pin the client checks that gate the request and marshal the typed payload.

function formWith(overrides: Partial<SubmissionForm> = {}): SubmissionForm {
  return {
    source: 'github',
    eventType: 'push',
    payload: '{"action":"opened"}',
    headers: '{}',
    attempts: [
      {
        ...emptyAttempt(),
        requestUrl: 'https://example.com/webhook',
        requestMethod: 'POST',
        requestHeaders: '{}',
        responseStatus: '401',
      },
    ],
    ...overrides,
  };
}

describe('validateSubmission', () => {
  it('accepts a well-formed submission and marshals the typed input', () => {
    const { errors, input } = validateSubmission(formWith());
    expect(errors).toEqual({});
    expect(input).not.toBeNull();
    expect(input).toMatchObject({
      source: 'github',
      eventType: 'push',
      payload: { action: 'opened' },
      attempts: [{ requestUrl: 'https://example.com/webhook', responseStatus: 401 }],
    });
  });

  it('flags missing required top-level fields and returns no input', () => {
    const { errors, input } = validateSubmission(formWith({ source: '  ', eventType: '' }));
    expect(errors.source).toBe('Required.');
    expect(errors.eventType).toBe('Required.');
    expect(input).toBeNull();
  });

  it('rejects malformed JSON in the payload', () => {
    const { errors } = validateSubmission(formWith({ payload: '{not json' }));
    expect(errors.payload).toBe('Invalid JSON.');
  });

  it('requires an http(s) scheme on the request URL', () => {
    const { errors } = validateSubmission(
      formWith({
        attempts: [{ ...emptyAttempt(), requestUrl: 'mailto:x@y.com', requestMethod: 'POST' }],
      }),
    );
    expect(errors['attempt0.requestUrl']).toBe('Must be an http(s) URL.');
  });

  it('rejects an unparseable URL', () => {
    const { errors } = validateSubmission(
      formWith({
        attempts: [{ ...emptyAttempt(), requestUrl: 'not a url', requestMethod: 'POST' }],
      }),
    );
    expect(errors['attempt0.requestUrl']).toBe('Must be a valid URL.');
  });

  it('rejects a non-integer response status and a negative latency', () => {
    const { errors } = validateSubmission(
      formWith({
        attempts: [
          {
            ...emptyAttempt(),
            requestUrl: 'https://example.com/webhook',
            requestMethod: 'POST',
            responseStatus: '40x',
            latencyMs: '-5',
          },
        ],
      }),
    );
    expect(errors['attempt0.responseStatus']).toBe('Must be an integer.');
    expect(errors['attempt0.latencyMs']).toBe('Must be a non-negative integer.');
  });

  it('omits optional fields left blank rather than sending empty values', () => {
    const { input } = validateSubmission(
      formWith({
        attempts: [
          {
            ...emptyAttempt(),
            requestUrl: 'https://example.com/webhook',
            requestMethod: 'POST',
          },
        ],
      }),
    );
    const attempt = input?.attempts[0];
    expect(attempt).toBeDefined();
    expect(attempt).not.toHaveProperty('responseStatus');
    expect(attempt).not.toHaveProperty('latencyMs');
    expect(attempt).not.toHaveProperty('errorText');
  });
});
