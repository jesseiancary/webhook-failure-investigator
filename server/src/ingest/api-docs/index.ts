import type { ApiDocEntry } from './types.js';

import stripeDocs from './stripe.js';
import githubDocs from './github.js';
import slackDocs from './slack.js';

// The reference-doc corpus retrieved by `fetch_api_docs`. Grouped by provider, spanning the
// behaviors the seeded scenarios hinge on (signatures, auth, rate limits, payload shape, timeouts).
// The seed loader (../seed.ts) persists each entry to the ApiDoc table under a stable `doc_` id so
// re-seeding is idempotent. Add docs for a provider in its file, or add a new provider file and
// append it here.
export const apiDocs: ApiDocEntry[] = [...stripeDocs, ...githubDocs, ...slackDocs];

export type { ApiDocEntry } from './types.js';
