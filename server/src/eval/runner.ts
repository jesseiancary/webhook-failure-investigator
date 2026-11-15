import { DiagnosisSchema, type Diagnosis } from '../diagnosis/diagnosis.schema.js';
import { investigateEvent } from '../diagnosis/diagnosis.service.js';
import type { DiagnosisClient } from '../diagnosis/openai.js';
import { labeledScenarios } from './labels.js';
import { scoreScenarios } from './scorers.js';
import type { Scorecard } from './types.js';

// The harness runner: drive a diagnosis for every labeled scenario and score the results. It assumes
// the scenarios are already seeded (each is persisted under its `key` as the WebhookEvent id — see
// ingest/seed.ts; the CLI in PR2 and the integration test seed first). It reads the produced diagnosis
// back from the persisted Investigation, so the eval scores exactly what the product stored, not a
// side channel. The DiagnosisClient seam lets a caller run against real OpenAI (default), the env-gated
// fake (WFI_FAKE_LLM=1, plumbing only), or a deterministic stub (tests).

/** The per-scenario record of one eval run, carrying the accounting PR2 aggregates for the scorecard. */
export interface EvalRun {
  key: string;
  diagnosis: Diagnosis;
  model: string;
  promptVersion: string | null;
  promptTokens: number;
  completionTokens: number;
  /** Stringified Decimal (serializable; summed by PR2's exporter). */
  costUsd: string;
}

export interface EvalResult {
  runs: EvalRun[];
  scorecard: Scorecard;
}

/**
 * Investigate every seeded scenario with the given client (default: the real/fake OpenAI client per
 * env) and score the diagnoses. Throws if a scenario isn't seeded, since an unseeded event would
 * silently drop from the scorecard and inflate the denominator's meaning — run `db:seed` first.
 */
export async function runEval(opts?: { client?: DiagnosisClient }): Promise<EvalResult> {
  const runs: EvalRun[] = [];
  const scenarios = labeledScenarios();

  for (const scenario of scenarios) {
    const investigation = await investigateEvent(scenario.key, { client: opts?.client });
    if (investigation === null) {
      throw new Error(
        `Scenario "${scenario.key}" is not seeded — run \`pnpm --filter server db:seed\` before the eval.`,
      );
    }
    runs.push({
      key: scenario.key,
      diagnosis: DiagnosisSchema.parse(investigation.diagnosis),
      model: investigation.model,
      promptVersion: investigation.promptVersion,
      promptTokens: investigation.promptTokens,
      completionTokens: investigation.completionTokens,
      costUsd: investigation.costUsd.toString(),
    });
  }

  const byKey = new Map(scenarios.map((scenario) => [scenario.key, scenario]));
  const scorecard = scoreScenarios(
    runs.map((run) => ({ scenario: byKey.get(run.key)!, diagnosis: run.diagnosis })),
  );

  return { runs, scorecard };
}
