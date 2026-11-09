import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

// Load the single repo-root .env regardless of cwd. Run commands execute with
// cwd = server/ (pnpm --filter / -r), so a bare loadDotenv() would miss the root
// file. This module lives three levels below the root under both tsx (src/config)
// and compiled dist (dist/config). Values already in process.env (shell/CI) win.
const repoRootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
loadDotenv({ path: repoRootEnv });

type NodeEnv = 'development' | 'test' | 'production';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
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
    // Pinned snapshot with full Structured Outputs support; overridable for a cheaper/newer tier.
    return process.env.OPENAI_MODEL ?? 'gpt-4o-2024-08-06';
  },
};
