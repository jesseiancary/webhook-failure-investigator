import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEntrypoint } from '../cli/run-entrypoint.js';
import { env } from '../config/env.js';
import { seedApiDocs, seedScenarios } from '../ingest/seed.js';
import { buildReport, renderMarkdown, reportFileStem, type EvalMode } from './report.js';
import { resolveVariant, type PromptVariant } from './prompt-variants.js';
import { runEval } from './runner.js';
import {
  checkThresholds,
  DEFAULT_THRESHOLDS,
  type EvalThresholds,
  type ThresholdResult,
} from './thresholds.js';

// The `pnpm eval [variant] [--check]` entry point. Thin, like prisma/seed.ts: it resolves the run
// mode and prompt variant, seeds the labeled scenarios (the runner reads the produced Investigations
// back, so they must be persisted first), drives runEval against the real-or-fake client the env
// selects with the selected prompt, renders a compact scorecard to stdout, and — on a real run only —
// exports a timestamped JSON + Markdown pair to docs/eval/ for committing and diffing across variants.
//
// `[variant]` selects a prompt from the PR3 registry (default | regressed-no-grounding); the regressed
// variant is the A/B control that proves the harness catches a weakened prompt. `--check` enforces the
// quality thresholds (exit non-zero below the bar) on a real run — the opt-in `eval-threshold` gate.
// A fake run (WFI_FAKE_LLM) is plumbing only: it prints but never exports, and never enforces
// thresholds (the canned fake diagnosis is not a quality measurement).

// docs/eval/ lives at the repo root; resolve from this module's location (src/eval under tsx) rather
// than cwd, since the script runs with cwd = server/ (pnpm --filter server). REPO_ROOT also makes the
// exported-path log repo-root-relative (docs/eval/…) instead of a confusing ../docs/eval/… from server/.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EVAL_DOCS_DIR = path.join(REPO_ROOT, 'docs/eval');

/** The parsed `pnpm eval` invocation: an optional variant name and the `--check` threshold flag. */
export interface EvalArgs {
  variantName: string | undefined;
  check: boolean;
}

/** Parse the raw `process.argv.slice(2)`: at most one positional (the variant) plus the `--check` flag. */
export function parseEvalArgs(argv: string[]): EvalArgs {
  let variantName: string | undefined;
  let check = false;
  for (const arg of argv) {
    if (arg === '--check') {
      check = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag "${arg}". Usage: pnpm eval [variant] [--check]`);
    } else if (variantName === undefined) {
      variantName = arg;
    } else {
      throw new Error(`unexpected extra argument "${arg}". Usage: pnpm eval [variant] [--check]`);
    }
  }
  return { variantName, check };
}

/** Render the threshold verdict as console lines (printed after the scorecard when `--check` is set). */
function renderThresholdResult(result: ThresholdResult): string {
  const lines = result.checks.map((check) => {
    const mark = check.ok ? '✓' : '✗';
    const actual = `${(check.actual * 100).toFixed(1)}%`;
    const min = `${(check.min * 100).toFixed(1)}%`;
    return `  ${mark} ${check.name}: ${actual} (min ${min})`;
  });
  lines.unshift(result.passed ? 'Threshold check: PASS' : 'Threshold check: FAIL');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { variantName, check } = parseEvalArgs(process.argv.slice(2));
  const variant: PromptVariant = resolveVariant(variantName);
  const mode: EvalMode = env.FAKE_LLM ? 'fake' : 'real';

  // Resolve the quality bar up front, before any seeding or spend: reading env.EVAL_MIN_* validates
  // the WFI_EVAL_MIN_* overrides, so a malformed value (e.g. `--check` with a typo'd floor) fails fast
  // instead of after a real ~11-investigation run. Only needed when `--check` is set.
  const thresholds: EvalThresholds | null = check
    ? {
        minAccuracy: env.EVAL_MIN_ACCURACY ?? DEFAULT_THRESHOLDS.minAccuracy,
        minGroundingPassRate: env.EVAL_MIN_GROUNDING ?? DEFAULT_THRESHOLDS.minGroundingPassRate,
      }
    : null;

  // Seed first: the runner investigates each scenario by its seeded event id and reads the stored
  // Investigation back. Real runs also need the ApiDoc corpus the fetch_api_docs tool retrieves.
  const { created } = await seedScenarios();
  await seedApiDocs();
  console.log(
    `eval — seeded ${created} labeled scenario(s); running variant "${variant.name}" in ${mode} mode…\n`,
  );

  const result = await runEval({ prompt: variant.prompt });
  const report = buildReport(result, {
    label: variant.prompt.version,
    generatedAt: new Date().toISOString(),
    mode,
  });

  const md = renderMarkdown(report);
  console.log(md);

  if (mode === 'fake') {
    console.log('\n(plumbing run — WFI_FAKE_LLM is set; scorecard not exported to docs/eval/.)');
    if (check) {
      // The fake client returns one canned diagnosis for every scenario, so its numbers are not a
      // quality measurement — enforcing a threshold against them would be meaningless. Skip, loudly.
      console.log('(threshold check skipped — fake mode is plumbing only, not a quality run.)\n');
    }
    return;
  }

  await mkdir(EVAL_DOCS_DIR, { recursive: true });
  const stem = reportFileStem(report);
  const jsonPath = path.join(EVAL_DOCS_DIR, `${stem}.json`);
  const mdPath = path.join(EVAL_DOCS_DIR, `${stem}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(mdPath, `${md}\n`, 'utf8');
  console.log(
    `\nExported scorecard:\n  ${path.relative(REPO_ROOT, jsonPath)}\n  ${path.relative(REPO_ROOT, mdPath)}\n`,
  );

  if (thresholds !== null) {
    const verdict = checkThresholds(report.scorecard, thresholds);
    console.log(renderThresholdResult(verdict));
    if (!verdict.passed) {
      // Throw so runEntrypoint logs and exits non-zero — this is what makes `--check` a usable gate.
      throw new Error('eval thresholds not met (see the threshold check above).');
    }
  }
}

// Run only when invoked as the `pnpm eval` entry point, not when a unit test imports the pure helpers
// (importing must not kick off a seed/run against the DB).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runEntrypoint(main);
}
