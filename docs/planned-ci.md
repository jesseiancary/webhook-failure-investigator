# Planned CI Gates

Phased plan for GitHub Actions CI on this repo. **This is the authoritative gate catalog that the `/pr` command reads** to advise which checks are relevant before a PR.

## Why CI is (mostly) deferred

The repo is currently greenfield — only `.claude/` developer tooling and `docs/` exist. There is no `package.json`, `tsconfig`, or application source, so the substantial gates (typecheck, lint, test) have nothing to act on yet. Formal CI is a **Phase 2** milestone — see [ROADMAP.md](./ROADMAP.md) Phase 2 ("CI") and [PLAN.md](./PLAN.md) §7 ("Verification Strategy"). This document records the full rollout so nothing is forgotten and so `/pr` can nudge the author toward the right checks phase by phase.

No workflow files (`.github/workflows/*.yml`) exist today. They land with the toolchain in Phase 2.

---

## Gate catalog

Each gate lists **what it checks**, the **trigger** (the kind of change that makes it relevant), the **earliest phase** it can run, and the **tool / command**.

### Available now — Phase 1 tooling (lightweight, no app code required)

These can run against what already exists and protect the `.claude/` tooling itself.

| Gate | Checks | Trigger | Tool / command |
|---|---|---|---|
| settings-json-valid | `.claude/settings.json` parses as valid JSON | `.claude/settings.json` changed | `jq . .claude/settings.json` (or `python3 -m json.tool`) |
| hooks-shellcheck | Hook scripts are free of shell bugs | any `.claude/hooks/*.sh` changed | `shellcheck .claude/hooks/*.sh` |
| hooks-noop-guarantee | Hooks exit `0` (clean no-op) when the toolchain is absent | any `.claude/hooks/*.sh` changed | pipe a sample hook JSON payload to each script; assert exit code `0` |
| frontmatter-lint | Command/agent/skill files carry required frontmatter keys | any `.claude/commands/*.md`, `.claude/agents/*.md`, or `.claude/skills/**/SKILL.md` changed | lightweight script asserting `description` (commands), `name`/`description`/`tools`/`model` (agents), `name`/`description` (skills) |
| docs-link-check | Internal markdown links resolve | any `docs/*.md` or root `*.md` changed | a markdown link checker (e.g. `lychee --offline`) |

### Phase 2 — toolchain lands (the core gates, run on every PR)

This is the formally roadmapped CI milestone.

| Gate | Checks | Trigger | Tool / command |
|---|---|---|---|
| install | Reproducible install from the lockfile | any dependency/manifest change | `pnpm install --frozen-lockfile` |
| typecheck | No TypeScript errors across workspaces | any `*.ts` / `*.tsx` change | `pnpm typecheck` (`tsc --noEmit`) |
| lint | ESLint passes | any `*.ts` / `*.tsx` change | `pnpm lint` |
| format-check | Prettier formatting is clean | any source change | `pnpm prettier --check .` |
| test | Vitest unit + Supertest API tests pass | any source/test change | `pnpm test` |

### Phase 3+ — data layer

| Gate | Checks | Trigger | Tool / command |
|---|---|---|---|
| prisma-validate | Prisma schema is valid | `schema.prisma` changed | `prisma validate` |
| migration-drift | Schema and migrations are in sync (no uncommitted drift) | `schema.prisma` or `migrations/` changed | `prisma migrate diff` / `prisma migrate status` |
| secret-redaction-guard | No raw auth headers or tokens in fixtures, seeds, or snapshots | any seed/fixture/snapshot change | grep-based assertion over fixtures (ties to the CLAUDE.md secret-redaction rule) |

### Phase 7–8 — UI & evals

| Gate | Checks | Trigger | Tool / command |
|---|---|---|---|
| e2e | Playwright happy-path (submit → investigate → read → follow-up) | `/web` or API-contract change | `pnpm playwright test` |
| eval-threshold *(optional)* | Classification accuracy + grounding pass rate stay above a minimum | prompt version, few-shot set, or diagnosis schema change | `pnpm eval` with a threshold check (see PLAN.md §7) |

---

## Mapping table (gate → phase → relevant when)

Skim-friendly summary for `/pr` to reason over.

| Gate | Phase | Relevant when the change set touches… |
|---|---|---|
| settings-json-valid | 1 (now) | `.claude/settings.json` |
| hooks-shellcheck | 1 (now) | `.claude/hooks/*.sh` |
| hooks-noop-guarantee | 1 (now) | `.claude/hooks/*.sh` |
| frontmatter-lint | 1 (now) | `.claude/commands/*.md`, `.claude/agents/*.md`, `.claude/skills/**/SKILL.md` |
| docs-link-check | 1 (now) | `docs/*.md`, root `*.md` |
| install | 2 | dependency / manifest files |
| typecheck | 2 | `*.ts`, `*.tsx` |
| lint | 2 | `*.ts`, `*.tsx` |
| format-check | 2 | any source |
| test | 2 | source or tests |
| prisma-validate | 3 | `schema.prisma` |
| migration-drift | 3 | `schema.prisma`, `migrations/` |
| secret-redaction-guard | 3 | seeds, fixtures, snapshots |
| e2e | 7 | `/web`, API contracts |
| eval-threshold | 8 | prompts, few-shot, diagnosis schema |

**How `/pr` uses this:** for the files in the current change set, surface the matching gates — marking the Phase-1 gates as runnable today and later-phase gates as "planned (not yet applicable — toolchain/data layer absent)."
