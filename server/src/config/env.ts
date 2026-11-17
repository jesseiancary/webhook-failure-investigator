import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { expand } from 'dotenv-expand';

// Load the single repo-root .env regardless of cwd. Run commands execute with
// cwd = server/ (pnpm --filter / -r), so a bare loadDotenv() would miss the root
// file. This module lives three levels below the root under both tsx (src/config)
// and compiled dist (dist/config). Values already in process.env (shell/CI) win.
//
// expand() resolves `${VAR}` references within the .env (e.g. DATABASE_URL embeds
// ${POSTGRES_PORT}), so the host-run DB port is single-sourced. It respects the same
// precedence — a value already in process.env (the compose `environment:` DATABASE_URL
// override, shell, CI) is not clobbered. Caveat: a literal `$` in a value must be escaped `\$`.
const repoRootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
expand(loadDotenv({ path: repoRootEnv }));

type NodeEnv = 'development' | 'test' | 'production';

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
 * `process.env` directly so missing config fails loudly at boot.
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
