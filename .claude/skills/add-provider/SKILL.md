---
name: add-provider
description: Onboard a new webhook provider (e.g. Stripe, GitHub, Slack) into the Webhook Failure Investigator — seed scenarios, API docs for grounding, taxonomy nuances, and sample payloads. Use when adding support for a provider's webhooks.
---

# Add a webhook provider

Repeatable steps to onboard a new provider so the investigator can diagnose its webhook failures accurately and ground explanations in that provider's real behavior.

> Parts of this depend on later roadmap phases. If a target (seed module, `ApiDoc` store) doesn't exist yet, note which phase it belongs to (`docs/ROADMAP.md`) and complete the parts that are ready.

## 1. Research the provider's webhooks

- How does it authenticate deliveries (signature header, bearer token, HMAC)? Note the exact header names.
- What do success vs. failure responses look like? Which status codes map to which `failureCategory`?
- Retry/backoff policy and any idempotency keys or event IDs.
- A representative event payload and its headers.

## 2. Add API documentation for grounding

Add the provider's relevant docs to the `ApiDoc` store (Phase 5) so the `fetch_api_docs` tool can retrieve them: authentication, signature verification, error codes, and retry semantics. Keep sections small and query-friendly. Cite the source URL.

## 3. Add seed scenarios

Use `/seed-scenario <provider> <category>` to add realistic failure cases. Cover at least the categories this provider actually produces — commonly `authentication`, `payload_validation`, `rate_limit`, `server_error`. Each scenario needs an **expected diagnosis label** (category + the evidence fields a correct diagnosis must cite). **Redact secrets** in stored headers.

## 4. Capture taxonomy nuances

Note provider-specific mappings the model should know — e.g. a provider that returns `200` with an error body (→ `application_logic`), or a signature-mismatch `400` that is really `authentication`. Encode these as few-shot examples or prompt notes (Phase 4).

## 5. Verify with the eval harness

Run `/eval` (Phase 8) and confirm the new scenarios classify correctly and cite the expected evidence. Add any that fail to the regression set.

## Checklist

- [ ] Auth mechanism + header names documented
- [ ] Status-code → `failureCategory` mapping noted
- [ ] `ApiDoc` entries added (with source URLs)
- [ ] Seed scenarios added with expected labels; secrets redacted
- [ ] Provider-specific taxonomy nuances captured
- [ ] Evals pass for the new scenarios
