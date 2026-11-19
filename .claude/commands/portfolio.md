---
description: Generate or update docs/PORTFOLIO.md — a hiring-manager-facing portfolio writeup — from CLAUDE.md and docs/ROADMAP.md
allowed-tools: Read, Glob, Grep, Bash(git remote -v:*), Bash(git config --get remote.origin.url:*), Bash(git log:*)
---

Generate (or update) `docs/PORTFOLIO.md`: a portfolio writeup of **this project** aimed at
**hiring managers**. The author is using their portfolio to get a job, so the document must
be accurate, concrete, and legible to a technical reviewer skimming in under two minutes —
never a stub, never aspirational about things that don't exist.

## Sources of truth (read these first)

1. **`CLAUDE.md`** (repo root) — the project's purpose, architecture, conventions, and tech stack.
2. **`docs/ROADMAP.md`** — the phased build history. Treat **checked (`- [x]`)** items as done
   and **unchecked (`- [ ]`)** items as _not yet built_. Never describe an unchecked item as
   complete.
3. Then explore the repo as needed to ground specifics: `package.json`(s) for the real
   dependency list, the directory layout, and any `docs/PLAN.md` or similar for rationale.
   Infer the GitHub URL from `git config --get remote.origin.url` when present.

Every claim in the output must be backed by something that actually exists in the repo. If a
capability is only partially done, describe it honestly (e.g. "configured for X" vs. "running
on X"). When in doubt, prefer what the roadmap marks complete.

## If `docs/PORTFOLIO.md` already exists

**Preserve the author's hand-curated fields** — do not blank or overwrite them. Specifically,
carry these frontmatter values through unchanged unless the user explicitly asks otherwise:
`thumbnail`, `screenshots`, `githubUrl`, `liveUrl`, `featured`, `order`, and `date` (only bump
`date` if the user asks). Refresh the prose and the derived fields (`description`, `tech`,
`techStack`) to match the current state of the project. This is an **update**, not a rewrite:
keep good existing wording, correct anything now inaccurate, and fill gaps.

**`featured` and `order` are seed-on-create only.** Write their defaults (`featured: true`,
`order: 1`) when first creating the file, and from then on carry whatever the author set
through unchanged. Never update them on a refresh — even if the author has changed them.

If it does not exist, create it, leaving the hand-curated fields present but empty
(`thumbnail:`, `screenshots:`) for the author to fill, and derive `githubUrl`/`date` where you
safely can.

## Exact output format

Write the file as YAML frontmatter followed by Markdown sections, in **this exact shape**:

```markdown
---
title: <Project name>
description: <1–2 sentence hook — what it is and the headline skill it demonstrates. Reusable as a "list of projects" blurb.>

thumbnail:
screenshots:
githubUrl: <inferred from git remote, else leave blank>
liveUrl: <carry through existing value; else blank>
tech:
  - <4 headline technologies, most recognizable first>
  - ...
techStack:
  - label: <group, e.g. Backend>
    items:
      - <technology>
  - label: <group, e.g. Frontend>
    items:
      - ...
  # include the groups that fit the project — commonly: Backend, Frontend,
  # Testing & quality, Ops, Architecture
featured: true
order: 1
date: <YYYY-MM-DD>
---

## Overview

<2 short paragraphs. First: the real-world problem and what the project does about it, in
plain language a non-specialist hiring manager understands. Second: the goals/intent and that
it's a genuinely working product, not a demo.>

## Tech stack

- **<Group>** - <prose sentence naming the technologies in that group and what they're for.>
- ... <one bullet per techStack group above, prose form.>

## What I built

- **<Feature in bold>.** <What it is and why it matters, grounded in a real file/endpoint/schema.>
- ... <5–7 bullets covering the most impressive, concrete capabilities.>

## Engineering decisions & challenges

- **<Decision/challenge in bold>.** <The hard problem and how it was solved. This section is
  where senior signal lives — favor non-obvious trade-offs over routine setup.>
- ... <4–5 bullets.>

## Outcome

<One paragraph: what shipped, how it was built (phased/tested/CI), and a closing sentence
naming the transferable skills it demonstrates.>
```

## Rules

- **Section order is fixed:** Overview → Tech stack → What I built → Engineering decisions &
  challenges → Outcome. Add an extra section only if it genuinely helps a hiring manager, and
  place it before Outcome.
- **Each paragraph and each bullet must be a single line** — no hard-wrapping or line breaks
  within a paragraph or bullet. (The template above shows prose wrapped for readability;
  the generated file must not wrap it.) Blank lines still separate paragraphs and sections.
- Use a plain hyphen `-` (not an em dash) for inline asides, matching the existing file.
- In the YAML frontmatter, when a value must be quoted (e.g. it starts with `@` or contains a
  colon), use **single quotes**, not double — e.g. `'@wfi/contracts shared Zod package'`.
- Keep bullets tight and specific; name real modules, endpoints, schemas, and tools rather
  than generic claims.
- Do not invent metrics, dates, or URLs. Leave a field blank rather than guessing.
- After writing, tell the user which frontmatter fields still need their manual input
  (typically `thumbnail` and `screenshots`), and flag any place where the prose depends on a
  roadmap item that isn't checked off yet.
