import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEntrypoint } from '../cli/run-entrypoint.js';
import { env } from '../config/env.js';
import { PROMPT_VERSION } from '../diagnosis/prompt.js';
import { seedApiDocs, seedScenarios } from '../ingest/seed.js';
import { buildReport, renderMarkdown, reportFileStem, type EvalMode } from './report.js';
import { runEval } from './runner.js';

// The `pnpm eval [prompt-version]` entry point. Thin, like prisma/seed.ts: it resolves the run mode,
// seeds the labeled scenarios (the runner reads the produced Investigations back, so they must be
// persisted first), drives runEval against the real-or-fake client the env selects, renders a compact
// scorecard to stdout, and — on a real run only — exports a timestamped JSON + Markdown pair to
// docs/eval/ for committing and diffing across prompt versions. A fake run (WFI_FAKE_LLM) is plumbing
// only, so it prints but never writes a (meaningless) committed scorecard.
//
// The A/B prompt-override seam is PR3: there is no runtime prompt selection yet, so a `[prompt-version]`
// argument that names anything other than the current default is rejected with a pointer to PR3.

// docs/eval/ lives at the repo root; resolve from this module's location (src/eval under tsx) rather
// than cwd, since the script runs with cwd = server/ (pnpm --filter server). REPO_ROOT also makes the
// exported-path log repo-root-relative (docs/eval/…) instead of a confusing ../docs/eval/… from server/.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EVAL_DOCS_DIR = path.join(REPO_ROOT, 'docs/eval');

/** Validate the optional `[prompt-version]` arg against the one version PR2 can run; returns the label. */
export function resolveLabel(arg: string | undefined): string {
  if (arg === undefined || arg === PROMPT_VERSION) {
    return PROMPT_VERSION;
  }
  throw new Error(
    `prompt variant "${arg}" is not available: the prompt-override seam lands in Phase 8 PR3. ` +
      `Only the current default ("${PROMPT_VERSION}") runs today — re-run \`pnpm eval\` with no argument.`,
  );
}

async function main(): Promise<void> {
  const label = resolveLabel(process.argv[2]);
  const mode: EvalMode = env.FAKE_LLM ? 'fake' : 'real';

  // Seed first: the runner investigates each scenario by its seeded event id and reads the stored
  // Investigation back. Real runs also need the ApiDoc corpus the fetch_api_docs tool retrieves.
  const { created } = await seedScenarios();
  await seedApiDocs();
  console.log(`eval — seeded ${created} labeled scenario(s); running in ${mode} mode…\n`);

  const result = await runEval();
  const report = buildReport(result, {
    label,
    generatedAt: new Date().toISOString(),
    mode,
  });

  const md = renderMarkdown(report);
  console.log(md);

  if (mode === 'fake') {
    console.log('\n(plumbing run — WFI_FAKE_LLM is set; scorecard not exported to docs/eval/.)\n');
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
}

// Run only when invoked as the `pnpm eval` entry point, not when a unit test imports `resolveLabel`
// (importing must not kick off a seed/run against the DB).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runEntrypoint(main);
}
