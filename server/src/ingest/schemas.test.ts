import { describe, expect, it } from 'vitest';
import { ManualSubmissionSchema } from './schemas.js';

const validSubmission = {
  source: 'stripe',
  eventType: 'invoice.payment_failed',
  payload: { id: 'evt_123', object: 'event' },
  headers: { 'Content-Type': 'application/json' },
  attempts: [
    {
      requestUrl: 'https://api.example.com/webhooks/stripe',
      requestMethod: 'POST',
      requestHeaders: { Authorization: 'Bearer sk-live-abc' },
      responseStatus: 401,
    },
  ],
};

describe('ManualSubmissionSchema', () => {
  it('accepts a well-formed submission', () => {
    const parsed = ManualSubmissionSchema.safeParse(validSubmission);
    expect(parsed.success).toBe(true);
  });

  it('coerces attemptedAt into a Date', () => {
    const parsed = ManualSubmissionSchema.parse({
      ...validSubmission,
      attempts: [{ ...validSubmission.attempts[0], attemptedAt: '2026-11-08T02:00:00.000Z' }],
    });
    expect(parsed.attempts[0].attemptedAt).toBeInstanceOf(Date);
  });

  it('requires at least one attempt', () => {
    const parsed = ManualSubmissionSchema.safeParse({ ...validSubmission, attempts: [] });
    expect(parsed.success).toBe(false);
  });

  it('rejects a non-URL requestUrl', () => {
    const parsed = ManualSubmissionSchema.safeParse({
      ...validSubmission,
      attempts: [{ ...validSubmission.attempts[0], requestUrl: 'not-a-url' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a missing source', () => {
    const { source: _source, ...withoutSource } = validSubmission;
    expect(ManualSubmissionSchema.safeParse(withoutSource).success).toBe(false);
  });
});
