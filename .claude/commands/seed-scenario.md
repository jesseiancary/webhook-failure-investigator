---
description: Scaffold a new seeded webhook-failure scenario (event + delivery attempts + expected diagnosis label)
argument-hint: <provider> <failure-category>
---

You are scaffolding a new seeded failure scenario for the Webhook Failure Investigator.

**Guard:** If the data layer isn't scaffolded yet (no `server/prisma/schema.prisma` and no seed module), tell the user that seeding arrives in roadmap Phase 3, point them at `docs/ROADMAP.md`, and stop.

Arguments: `$ARGUMENTS` — first token is the provider (e.g. `stripe`, `github`, `slack`, `custom`), second is the target failure category.

Valid failure categories (the taxonomy enum): `authentication`, `payload_validation`, `timeout`, `network_failure`, `rate_limit`, `server_error`, `application_logic`, `insufficient_evidence`.

Steps:
1. Validate the category against the enum above; if invalid or missing, list the options and ask.
2. Create a realistic scenario for that provider + category, including:
   - A `WebhookEvent` (source, eventType, a plausible payload, headers).
   - One or more `DeliveryAttempt` records showing the failure (request URL/method/headers/body, response status/headers/body, latency, error text). **Redact any secrets/tokens** in stored headers.
   - An **expected diagnosis label** (the category + the key evidence fields a correct diagnosis must cite) so the eval harness can score it.
3. Add the scenario to the seed source alongside existing scenarios, matching their structure and style.
4. Summarize what you created and how to load it (`pnpm --filter server db:seed`).

Keep the scenario faithful to how that provider's webhooks actually look. Ground the "expected evidence" in concrete fields (e.g. `responseStatus: 401`, a `WWW-Authenticate` header), never vague prose.
