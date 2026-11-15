import { describe, expect, it } from 'vitest';
import { parseEvalArgs } from './cli.js';

// Pure unit tests for the CLI's arg parsing. The rest of cli.ts is I/O (seed, run, write, export)
// exercised by the manual `pnpm eval` smoke and the runner integration test; parseEvalArgs is the one
// piece of branching logic worth pinning here. Variant resolution lives in prompt-variants.test.ts and
// the threshold math in thresholds.test.ts. (Importing this module does not kick off a run — cli.ts
// guards its main() on being the entry point.)

describe('parseEvalArgs', () => {
  it('defaults to no variant and no check when given nothing', () => {
    expect(parseEvalArgs([])).toEqual({ variantName: undefined, check: false });
  });

  it('reads a positional variant name', () => {
    expect(parseEvalArgs(['regressed-no-grounding'])).toEqual({
      variantName: 'regressed-no-grounding',
      check: false,
    });
  });

  it('reads the --check flag in any position', () => {
    expect(parseEvalArgs(['--check'])).toEqual({ variantName: undefined, check: true });
    expect(parseEvalArgs(['default', '--check'])).toEqual({ variantName: 'default', check: true });
    expect(parseEvalArgs(['--check', 'default'])).toEqual({ variantName: 'default', check: true });
  });

  it('rejects an unknown flag', () => {
    expect(() => parseEvalArgs(['--nope'])).toThrow(/unknown flag/);
  });

  it('rejects a second positional argument', () => {
    expect(() => parseEvalArgs(['default', 'extra'])).toThrow(/extra argument/);
  });
});
