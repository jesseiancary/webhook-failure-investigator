---
name: portfolio-prep
description: Produce the Phase 11 hiring-manager-facing deliverables — README with architecture + live demo, demo GIF, an engineering-decisions writeup, and the embedded eval scorecard. Use when building Phase 11.
---

# Portfolio presentation (Phase 11)

Make the work legible and compelling to hiring managers — the project's second explicit goal in `CLAUDE.md` ("a portfolio piece … fully functioning and genuinely usable, not a demo stub").

> This is **Phase 11** (`docs/ROADMAP.md`) and assumes a live URL (Phase 10) and the eval scorecard (Phase 8) already exist. If one isn't ready, note the phase and prepare the parts that are.

## What to produce

1. **README** — architecture diagram, live demo link, and the quickstart (install → compose up → migrate → dev). Lead with what the project _is_ and the one hard thing it does well.
2. **Demo GIF / screenshots** of the full flow: submit → investigate → read the grounded diagnosis → ask a follow-up. Show the evidence citations and the token/cost line — they're the credibility signals.
3. **Engineering-decisions writeup** — the parts a reviewer actually cares about: why **structured output** (Zod-once, shared with validation), how **grounding** is enforced (cite-real-fields or `insufficient_evidence`), **cost controls** (per-`Investigation` token/cost accounting, cheaper follow-up tier), and **context management** (token budgeting, truncation with pointers).
4. **Embed the eval scorecard** from Phase 8 so quality claims are backed by numbers.
5. A one-paragraph **"what this demonstrates"** summary for non-technical reviewers.

## The bar (roadmap verification)

- A new reader goes README → live demo → understanding the LLM design in **under 5 minutes**.
- **Every claim in the README is backed by something runnable in the repo** — no aspirational prose. If you can't point to the code or a live action behind a sentence, cut it or build it.

## Checklist

- [ ] README: architecture diagram + live demo link + quickstart
- [ ] Demo GIF/screenshots of the full flow (citations + cost visible)
- [ ] Engineering-decisions writeup (structured output, grounding, cost, context)
- [ ] Eval scorecard embedded
- [ ] "What this demonstrates" paragraph for non-technical readers
- [ ] Every README claim maps to runnable code or a live action
