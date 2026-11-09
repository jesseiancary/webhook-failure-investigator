import { prisma } from '../../db/client.js';

// `fetch_api_docs(provider, query)` — keyword retrieval over the seeded ApiDoc corpus. Reference
// docs ground the model's *explanation and remediation* (e.g. "Stripe signs with Stripe-Signature;
// a mismatch is a 400"); they are NOT delivery-log evidence, so the system prompt (PR2) still
// requires `evidence[]` to cite log fields. v1 is deliberately keyword-based (PLAN §8: embeddings
// are a later upgrade). The ranking is a pure function so it unit-tests without a database.

/** A reference-doc row the ranker scores. Structural (not the Prisma type) so ranking stays DB-free. */
export interface RankableDoc {
  section: string;
  content: string;
}

export interface RankedDoc<T extends RankableDoc> {
  doc: T;
  score: number;
}

const SECTION_MATCH_WEIGHT = 2;
const CONTENT_MATCH_WEIGHT = 1;
const DEFAULT_LIMIT = 3;
// Drop 1-character terms: a stray "a"/"i" is a substring of nearly every doc and would match
// everything. Scoring itself stays substring-based (`.includes`) on purpose — that's plural- and
// compound-friendly (limit↔limits, sha↔sha256), which suits keyword-retrieval v1. Embeddings are
// the later precision upgrade (PLAN §8).
const MIN_TERM_LENGTH = 2;

/** Split a query into lowercased, de-duplicated word tokens (alphanumerics only, ≥2 chars). */
function tokenize(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TERM_LENGTH);
  return [...new Set(tokens)];
}

/**
 * Rank reference docs against a keyword query by term overlap. A term found in the (short, salient)
 * `section` title scores higher than one found only in the body, so a query like "signature" surfaces
 * the signature-verification section ahead of a doc that merely mentions the word in passing. Docs
 * with no overlap are dropped; the top `limit` survive. The sort is stable, so equal scores preserve
 * the corpus order (keeping output deterministic for a given seed).
 */
export function rankApiDocs<T extends RankableDoc>(
  docs: readonly T[],
  query: string,
  limit = DEFAULT_LIMIT,
): RankedDoc<T>[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  return docs
    .map((doc) => {
      const section = doc.section.toLowerCase();
      const content = doc.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (section.includes(term)) score += SECTION_MATCH_WEIGHT;
        else if (content.includes(term)) score += CONTENT_MATCH_WEIGHT;
      }
      return { doc, score };
    })
    .filter((ranked) => ranked.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * The `fetch_api_docs` executor: load the provider's reference docs and return the top keyword
 * matches as a citable text block. Returns a plain explanatory string when the provider is unknown or
 * nothing matches, so the model gets an honest "no docs" signal rather than an empty result it might
 * fill in by guessing.
 */
export async function fetchApiDocs(provider: string, query: string): Promise<string> {
  const docs = await prisma.apiDoc.findMany({ where: { provider } });
  if (docs.length === 0) {
    return `No API reference docs are available for provider "${provider}".`;
  }

  const matches = rankApiDocs(docs, query);
  if (matches.length === 0) {
    return `No API reference docs for provider "${provider}" matched the query "${query}".`;
  }

  const header = [
    `API DOCS — provider "${provider}" (${matches.length} section(s) matching "${query}")`,
    'Reference material, not delivery logs: use it to explain and remediate the failure, but still',
    'cite delivery-log field paths in evidence[].',
  ];
  const sections = matches.map(({ doc }) => `\n[${provider} › ${doc.section}]\n${doc.content}`);
  return [...header, ...sections].join('\n');
}
