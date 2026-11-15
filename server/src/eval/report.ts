import { Prisma } from '@prisma/client';
import type { EvalResult, EvalRun } from './runner.js';
import type { Scorecard } from './types.js';

// Turn a scored eval run into the committed artifact: a diffable JSON object and a compact Markdown
// scorecard, plus the token/cost accounting the CLAUDE.md rule requires on every LLM run. Kept pure
// (no fs, no DB, no process) so it is unit-tested with a canned EvalResult — cli.ts owns the I/O
// (seeding, running, writing files). The scoring stays in scorers.ts; this module only aggregates
// accounting across the runs and renders.

/** How the run was produced. A `fake` run is plumbing only (same canned diagnosis for every event). */
export type EvalMode = 'real' | 'fake';

/** The run-level accounting, summed across every investigation (matches the per-Investigation rule). */
export interface EvalAccounting {
  models: string[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Stringified Decimal sum (fixed 6dp, matching the costUsd column). */
  costUsd: string;
}

/** The full exported report: metadata + accounting + the pure Scorecard. This is what lands in docs/eval/. */
export interface EvalReport {
  meta: {
    /** The prompt version actually run (from the persisted Investigations). */
    promptVersion: string;
    /** The label the invoker passed (defaults to promptVersion); PR3's variant registry uses this. */
    label: string;
    generatedAt: string;
    mode: EvalMode;
    scenarioCount: number;
    models: string[];
  };
  accounting: EvalAccounting;
  scorecard: Scorecard;
}

function sumAccounting(runs: EvalRun[]): EvalAccounting {
  const promptTokens = runs.reduce((sum, run) => sum + run.promptTokens, 0);
  const completionTokens = runs.reduce((sum, run) => sum + run.completionTokens, 0);
  const costUsd = runs.reduce(
    (sum, run) => sum.plus(new Prisma.Decimal(run.costUsd)),
    new Prisma.Decimal(0),
  );
  return {
    models: [...new Set(runs.map((run) => run.model))].sort(),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costUsd: costUsd.toFixed(6),
  };
}

/**
 * The prompt version every run shares; falls back to the invoker's label if a run didn't record one.
 * The fallback is defensive forward-compat only: `investigateEvent` always persists `PROMPT_VERSION`
 * today (diagnosis.service.ts), so no current run yields a null `promptVersion` — it exists for PR3,
 * when the prompt-override seam could run a variant that records a different (or no) version.
 */
function runPromptVersion(runs: EvalRun[], label: string): string {
  return runs.find((run) => run.promptVersion != null)?.promptVersion ?? label;
}

/**
 * Assemble the exportable report from a scored run. `label` is the invoker's optional `[prompt-version]`
 * argument (defaults to the current version); `generatedAt` is injected so the output is deterministic
 * under test.
 */
export function buildReport(
  result: EvalResult,
  opts: { label: string; generatedAt: string; mode: EvalMode },
): EvalReport {
  const { runs, scorecard } = result;
  const accounting = sumAccounting(runs);
  return {
    meta: {
      promptVersion: runPromptVersion(runs, opts.label),
      label: opts.label,
      generatedAt: opts.generatedAt,
      mode: opts.mode,
      scenarioCount: scorecard.total,
      models: accounting.models,
    },
    accounting,
    scorecard,
  };
}

/** Filesystem-safe stem `<promptVersion>-<timestamp>` for the paired `.json` / `.md` artifacts. */
export function reportFileStem(report: EvalReport): string {
  const slug = report.meta.generatedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  return `${report.meta.promptVersion}-${slug}`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Render the report as a compact Markdown scorecard — the committed artifact and the console output. */
export function renderMarkdown(report: EvalReport): string {
  const { meta, accounting, scorecard } = report;
  const { classification, grounding, calibration } = scorecard;
  const lines: string[] = [];

  lines.push(`# Eval Scorecard — ${meta.promptVersion}`, '');
  if (meta.mode === 'fake') {
    lines.push(
      '> ⚠️ **Plumbing run (`WFI_FAKE_LLM`).** The fake client returns the same canned diagnosis',
      '> for every scenario, so these numbers verify wiring only — they are **not** a quality',
      '> measurement and are not exported.',
      '',
    );
  }
  lines.push(
    `- **Generated:** ${meta.generatedAt}`,
    `- **Mode:** ${meta.mode}`,
    `- **Model(s):** ${meta.models.join(', ') || '—'}`,
    `- **Scenarios:** ${meta.scenarioCount}`,
    '',
  );

  lines.push(
    '## Classification',
    '',
    `**Accuracy: ${pct(classification.accuracy)} (${classification.correct}/${scorecard.total})**`,
    '',
    '| Category | Correct | Total |',
    '| --- | --- | --- |',
  );
  for (const row of classification.perCategory) {
    lines.push(`| ${row.category} | ${row.correct} | ${row.total} |`);
  }
  lines.push('');
  if (classification.misclassified.length > 0) {
    lines.push('Misclassified:');
    for (const miss of classification.misclassified) {
      lines.push(
        `- \`${miss.key}\` — expected \`${miss.expected}\`, predicted \`${miss.predicted}\``,
      );
    }
  } else {
    lines.push('Misclassified: none');
  }
  lines.push('');

  // Mean coverage is over field-citation scenarios only; a run of nothing but refusals has an empty
  // coverage set (scorers reports 0), so render "n/a" rather than a 0.0% that reads as "grounded nothing".
  const fieldScenarioCount = scorecard.total - grounding.refusals.total;
  const coverageLine =
    fieldScenarioCount === 0 ? 'n/a (no field-citation scenarios)' : pct(grounding.meanCoverage);
  lines.push(
    '## Grounding',
    '',
    `- **Pass rate:** ${pct(grounding.passRate)} (${grounding.passed}/${scorecard.total})`,
    `- **Mean coverage (field scenarios):** ${coverageLine}`,
    `- **Refusals:** ${grounding.refusals.correct}/${grounding.refusals.total} refused correctly`,
    '',
  );
  if (grounding.failures.length > 0) {
    lines.push('Grounding failures:');
    for (const failure of grounding.failures) {
      lines.push(`- \`${failure.key}\` — ${failure.reason}`);
    }
  } else {
    lines.push('Grounding failures: none');
  }
  lines.push('');

  lines.push(
    '## Calibration',
    '',
    `- **OK rate:** ${pct(calibration.okRate)} (${calibration.ok}/${scorecard.total})`,
    '',
  );
  if (calibration.mismatches.length > 0) {
    lines.push('Calibration mismatches:');
    for (const mismatch of calibration.mismatches) {
      lines.push(`- \`${mismatch.key}\` — ${mismatch.note}`);
    }
  } else {
    lines.push('Calibration mismatches: none');
  }
  lines.push('');

  lines.push(
    '## Per-scenario',
    '',
    '| Scenario | Expected | Predicted | Class | Grounded | Calibrated |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const row of scorecard.scenarios) {
    lines.push(
      `| \`${row.key}\` | ${row.expectedCategory} | ${row.predictedCategory} | ${
        row.classificationCorrect ? '✓' : '✗'
      } | ${row.grounded ? '✓' : '✗'} | ${row.calibrationOk ? '✓' : '✗'} |`,
    );
  }
  lines.push('');

  lines.push(
    '## Accounting',
    '',
    `- **Prompt tokens:** ${accounting.promptTokens}`,
    `- **Completion tokens:** ${accounting.completionTokens}`,
    `- **Total tokens:** ${accounting.totalTokens}`,
    `- **Cost (USD):** ${accounting.costUsd}`,
    '',
  );

  return lines.join('\n');
}
