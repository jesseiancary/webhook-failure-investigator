import { describe, expect, it } from 'vitest';
import { rankApiDocs, type RankableDoc } from './api-docs.js';

// Pure, DB-free checks on the keyword ranker that backs fetch_api_docs. The DB-backed executor
// (fetchApiDocs over the seeded corpus) is exercised in tools.int.test.ts.

const docs: RankableDoc[] = [
  { section: 'Signature verification', content: 'Verify the Stripe-Signature header using HMAC.' },
  { section: 'Authentication and API keys', content: 'A 401 means the credential expired.' },
  { section: 'Delivery retries and rate limits', content: 'A 429 carries a Retry-After header.' },
  { section: 'Event payload structure', content: 'A malformed body is rejected with 400.' },
];

describe('rankApiDocs', () => {
  it('surfaces the section whose title matches the query first', () => {
    const ranked = rankApiDocs(docs, 'signature');
    expect(ranked[0]?.doc.section).toBe('Signature verification');
  });

  it('weights a title match above a body-only match', () => {
    // "authentication" is in the Authentication title; "401" only appears in that doc's body too.
    const ranked = rankApiDocs(docs, 'authentication 401');
    expect(ranked[0]?.doc.section).toBe('Authentication and API keys');
    // Title hit (2) + body hit (1) = 3 beats any single-term match.
    expect(ranked[0]?.score).toBe(3);
  });

  it('drops docs with no term overlap', () => {
    const ranked = rankApiDocs(docs, 'signature');
    expect(ranked.every((r) => r.score > 0)).toBe(true);
    expect(ranked.map((r) => r.doc.section)).not.toContain('Event payload structure');
  });

  it('honors the result limit', () => {
    // Every doc mentions a status code or "header"; "header 401 400 429" touches several.
    const ranked = rankApiDocs(docs, 'header 401 400 429', 2);
    expect(ranked.length).toBeLessThanOrEqual(2);
  });

  it('returns nothing for an all-punctuation / empty query', () => {
    expect(rankApiDocs(docs, '   ')).toEqual([]);
    expect(rankApiDocs(docs, '!!!')).toEqual([]);
  });

  it('ignores 1-character noise terms', () => {
    // The stray "a" is a substring of nearly every doc; it must contribute nothing, so the result
    // is identical to querying "signature" alone.
    expect(rankApiDocs(docs, 'a signature')).toEqual(rankApiDocs(docs, 'signature'));
  });

  it('is case-insensitive and de-duplicates query terms', () => {
    expect(rankApiDocs(docs, 'SIGNATURE Signature signature')[0]?.doc.section).toBe(
      'Signature verification',
    );
  });
});
