// A seedable provider reference-doc entry. These are public API facts (how a provider signs
// webhooks, which status codes it returns, how it rate-limits) that ground the model's explanation
// and remediation — NOT delivery-log evidence, and never secrets. The seed loader persists them to
// the ApiDoc table; `fetch_api_docs` retrieves them by keyword. Add a provider by creating a file
// here and appending it to ./index.ts (the add-provider skill scaffolds this).

export interface ApiDocEntry {
  /** Stable, `doc_`-prefixed id used as the ApiDoc id for idempotent re-seeding. */
  id: string;
  /** Provider key, matching the webhook event `source` (e.g. 'stripe', 'github', 'slack'). */
  provider: string;
  /** Short, salient section title — weighted higher than the body in keyword retrieval. */
  section: string;
  /** The reference text itself. Public API documentation only; no secrets. */
  content: string;
}
