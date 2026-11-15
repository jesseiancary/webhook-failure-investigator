import { describe, expect, it } from 'vitest';
import { PROMPT_VERSION } from '../diagnosis/prompt.js';
import { resolveLabel } from './cli.js';

// Pure unit tests for the CLI's arg validation. The rest of cli.ts is I/O (seed, run, write) exercised
// by the manual `pnpm eval` smoke and the runner integration test; resolveLabel is the one piece of
// branching logic worth pinning: the prompt-override seam is PR3, so PR2 runs only the current version
// and rejects any other `[prompt-version]` argument with a pointer to PR3. (Importing this module does
// not kick off a run — cli.ts guards its main() on being the entry point.)

describe('resolveLabel', () => {
  it('defaults to the current prompt version when no argument is given', () => {
    expect(resolveLabel(undefined)).toBe(PROMPT_VERSION);
  });

  it('accepts the current prompt version explicitly', () => {
    expect(resolveLabel(PROMPT_VERSION)).toBe(PROMPT_VERSION);
  });

  it('rejects any other version and points at PR3', () => {
    expect(() => resolveLabel('diagnosis-v99')).toThrow(/Phase 8 PR3/);
    expect(() => resolveLabel('diagnosis-v99')).toThrow(/diagnosis-v99/);
  });
});
