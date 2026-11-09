import { describe, expect, it } from 'vitest';
import { rankApiDocs } from '../../diagnosis/tools/api-docs.js';
import { API_DOC_ID_PREFIX } from '../seed.js';
import { apiDocs } from './index.js';

// DB-free checks on the reference-doc corpus itself (mirrors scenarios.test.ts for the scenario
// library): every entry is well-formed and keyword-retrievable. The persistence/seeding behavior is
// covered by seed + tools.int.test.ts.

const MIN_CONTENT_LENGTH = 40;

describe('ApiDoc corpus', () => {
  it('has unique, doc-prefixed ids', () => {
    const ids = apiDocs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith(API_DOC_ID_PREFIX)).toBe(true);
  });

  it.each(apiDocs.map((d) => [d.id, d] as const))('%s is well-formed', (_id, doc) => {
    expect(doc.provider.length).toBeGreaterThan(0);
    expect(doc.section.length).toBeGreaterThan(0);
    expect(doc.content.length).toBeGreaterThanOrEqual(MIN_CONTENT_LENGTH);
  });

  it.each(apiDocs.map((d) => [d.id, d] as const))(
    '%s is retrievable by its own section title',
    (_id, doc) => {
      const sameProvider = apiDocs.filter((d) => d.provider === doc.provider);
      const ranked = rankApiDocs(sameProvider, doc.section, sameProvider.length);
      expect(ranked.map((r) => r.doc.id)).toContain(doc.id);
    },
  );
});
