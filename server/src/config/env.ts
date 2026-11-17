import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

// Load the single repo-root .env regardless of cwd. Run commands execute with
// cwd = server/ (pnpm --filter / -r), so a bare loadDotenv() would miss the root
// file. This module lives three levels below the root under both tsx (src/config)
// and compiled dist (dist/config).
//
// Values are loaded literally (no `${VAR}` interpolation) and a value already in
// process.env (the compose `environment:` DATABASE_URL override, shell, CI) is not
// clobbered — dotenv never overrides a pre-set variable.
const repoRootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
loadDotenv({ path: repoRootEnv });

type NodeEnv = 'development' | 'test' | 'production';

// The reasoning-effort levels the OpenAI Responses API accepts (its `reasoning.effort`), mirrored
// here so a bad override fails loudly at boot instead of on the first live call. 'none' reproduces
// the pre-Responses behavior (no reasoning); the diagnosis default is 'medium'.
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Parse an optional env var constrained to the unit interval [0,1]. Unset → `undefined` (the caller
 * supplies the default). Set-but-invalid (blank, non-numeric, or out of range) throws, so a typo
 * fails loudly rather than silently resolving to `0` (`Number('')` is `0`).
 */
function unitInterval(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const value = raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number in [0,1] when set; got "${raw}".`);
  }
  return value;
}

/**
 * Typed, validated access to the environment. Prefer importing `env` over reading
 * `process.env` directly so missing/invalid config fails loudly on first use (these are lazy
 * getters, so validation happens when a value is first read, not at process start).
 */
export const env = {
  get DATABASE_URL(): string {
    return required('DATABASE_URL');
  },
  get PORT(): number {
    const parsed = Number(process.env.PORT);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 3000;
  },
  get NODE_ENV(): NodeEnv {
    return (process.env.NODE_ENV as NodeEnv | undefined) ?? 'development';
  },
  get WEB_DIST_PATH(): string | undefined {
    // Optional override for where the built web bundle (web/dist) lives, served by express.static in
    // production for the single-origin deploy (Phase 10, B1). Unset → app.ts resolves it relative to
    // the compiled server (../../web/dist, i.e. the runtime image's /app/web/dist). An explicit value
    // also force-enables static serving outside production (handy for a local prod-parity smoke).
    const raw = process.env.WEB_DIST_PATH;
    return raw === undefined || raw === '' ? undefined : raw;
  },
  get OPENAI_API_KEY(): string {
    return required('OPENAI_API_KEY');
  },
  get OPENAI_MODEL(): string {
    // Current-generation model with Structured Outputs support; overridable for a different tier.
    return process.env.OPENAI_MODEL ?? 'gpt-6-luna';
  },
  get OPENAI_CHAT_MODEL(): string {
    // Follow-up chat model (Phase 6). Chat advertises no tools and no structured output, so it can
    // run on a cheaper/faster tier than diagnosis without code changes; defaults to the same model.
    return process.env.OPENAI_CHAT_MODEL ?? 'gpt-6-luna';
  },
  get OPENAI_REASONING_EFFORT(): ReasoningEffort {
    // Diagnosis reasoning effort for the Responses API (Phase 5 → PR3). The default 'medium' is a
    // balanced setting for grounded tool-using diagnosis; override per-deploy for cost/quality (e.g.
    // 'high' for the hardest cases). 'none' makes the client OMIT the reasoning param entirely — it
    // both disables reasoning and is the value to use with a non-reasoning OPENAI_MODEL (which rejects
    // the field). A value outside the known set throws on first read (the first diagnosis request),
    // rather than silently reaching the API as an invalid argument.
    const raw = process.env.OPENAI_REASONING_EFFORT;
    if (raw === undefined || raw === '') {
      return 'medium';
    }
    if (!(REASONING_EFFORTS as readonly string[]).includes(raw)) {
      throw new Error(
        `OPENAI_REASONING_EFFORT must be one of ${REASONING_EFFORTS.join(', ')}; got "${raw}".`,
      );
    }
    return raw as ReasoningEffort;
  },
  get FAKE_LLM(): boolean {
    // Offline/e2e mode (Phase 7): when set, the diagnosis/chat client factories return deterministic
    // fakes instead of calling OpenAI, so the whole stack runs with no API key and no network — which
    // is what the Playwright happy-path drives. Opt-in only (`WFI_FAKE_LLM=1`); unset in production.
    return process.env.WFI_FAKE_LLM === '1';
  },
  get EVAL_MIN_ACCURACY(): number | undefined {
    // Optional override for the Phase-8 `pnpm eval --check` classification-accuracy floor; the default
    // lives in eval/thresholds.ts (DEFAULT_THRESHOLDS). `undefined` here means "use that default".
    return unitInterval('WFI_EVAL_MIN_ACCURACY');
  },
  get EVAL_MIN_GROUNDING(): number | undefined {
    // Optional override for the `pnpm eval --check` grounding-pass-rate floor; default in thresholds.ts.
    return unitInterval('WFI_EVAL_MIN_GROUNDING');
  },
};
