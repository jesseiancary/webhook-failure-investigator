import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/client.js';
import type { Diagnosis } from '../diagnosis/diagnosis.schema.js';
import type { DiagnosisClient } from '../diagnosis/openai.js';
import type { ChatMessage } from '../diagnosis/prompt.js';
import { scenarios } from '../ingest/scenarios/index.js';
import { seedScenarios } from '../ingest/seed.js';
import { resolveVariant } from './prompt-variants.js';
import { runEval } from './runner.js';

// The end-to-end "harness has teeth" gate (ROADMAP Phase 8): a deliberately regressed prompt is caught
// by the eval. It runs against a real Postgres (DATABASE_URL must point at a test DB) but NO model and
// NO key — a *prompt-aware* stub stands in for the LLM. The stub is the crux: it inspects the system
// prompt the prompt-override seam actually delivered and behaves like a model would — grounded when the
// grounding invariant is present, and guessing (confident, uncited) when the regressed variant has
// stripped it. That makes the regression deterministic and free, while a real `pnpm eval default` vs
// `pnpm eval regressed-no-grounding` with a key reproduces the same drop on a real model (maintainer
// step). PR1's scorers.test.ts proves the scorers catch a regressed *result set*; this proves the whole
// pipeline — override seam → runner → persisted Investigation → scorecard — catches a regressed *prompt*.

async function resetDb(): Promise<void> {
  await prisma.investigation.deleteMany();
  await prisma.deliveryAttempt.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.captureEndpoint.deleteMany();
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * A stub standing in for the model that *reacts to the prompt it was given* — the point of the test.
 * It reads the system prompt (messages[0]) the override seam delivered:
 *   - Grounding invariant present (the default prompt) → behave like a well-grounded model: predict the
 *     scenario's true category, cite a real log field, and refuse (speculatively) the ambiguous case.
 *   - Grounding invariant absent (the regressed variant) → behave like a model that lost the rule:
 *     confidently guess `authentication` for everything and cite nothing.
 * The eventId is read from the investigation-request user message, exactly as the production flow names it.
 */
function promptAwareStub(): DiagnosisClient {
  return {
    async runDiagnosis(messages: ChatMessage[]) {
      const system = messages[0]?.role === 'system' ? messages[0].content : '';
      const grounded = system.includes('GROUNDING RULE');

      const last = messages.at(-1);
      const userContent = last?.role === 'user' ? last.content : '';
      const key = /eventId: (\S+)/.exec(userContent)?.[1] ?? '';
      const scenario = scenarios.find((s) => s.key === key);
      const trueCategory = scenario?.expected.category ?? 'insufficient_evidence';

      let diagnosis: Diagnosis;
      if (grounded) {
        const refuses = trueCategory === 'insufficient_evidence';
        diagnosis = {
          failureCategory: trueCategory,
          rootCause: 'grounded stub diagnosis',
          confidence: refuses ? 0.3 : 0.9,
          evidence: refuses
            ? []
            : [{ field: 'attempts[0].responseStatus', value: 'cited', note: 'grounded' }],
          remediationSteps: ['stub'],
          reachabilityAssessment: 'unknown',
          isSpeculative: refuses,
        };
      } else {
        // The regression: no grounding rule → a confident, uncited guess for every scenario.
        diagnosis = {
          failureCategory: 'authentication',
          rootCause: 'ungrounded guess',
          confidence: 0.95,
          evidence: [],
          remediationSteps: ['stub'],
          reachabilityAssessment: 'unknown',
          isSpeculative: false,
        };
      }

      return {
        diagnosis,
        usage: { promptTokens: 100, completionTokens: 20 },
        model: 'stub-model',
        toolCalls: [],
      };
    },
  };
}

describe('the eval catches a regressed prompt end to end', () => {
  it('scores the regressed-no-grounding variant strictly worse than the default', async () => {
    await seedScenarios();
    const client = promptAwareStub();

    const defaultRun = await runEval({ client, prompt: resolveVariant('default').prompt });
    const regressedRun = await runEval({
      client,
      prompt: resolveVariant('regressed-no-grounding').prompt,
    });

    // Each run records the variant it ran, so the two scorecards are comparable and export distinctly.
    expect(defaultRun.runs[0]?.promptVersion).toBe('diagnosis-v2');
    expect(regressedRun.runs[0]?.promptVersion).toBe('diagnosis-v2-regressed-nogrounding');

    // The default prompt grounds: perfect classification, some grounding.
    expect(defaultRun.scorecard.classification.accuracy).toBe(1);
    expect(defaultRun.scorecard.grounding.passRate).toBeGreaterThan(0);

    // The regression is caught: classification collapses (only the auth scenarios survive the guess)
    // and grounding goes to zero (nothing is cited).
    expect(regressedRun.scorecard.classification.accuracy).toBeLessThan(
      defaultRun.scorecard.classification.accuracy,
    );
    expect(regressedRun.scorecard.grounding.passRate).toBeLessThan(
      defaultRun.scorecard.grounding.passRate,
    );
    expect(regressedRun.scorecard.grounding.passRate).toBe(0);
  });
});
