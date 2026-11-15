import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/client.js';
import type { Diagnosis } from '../diagnosis/diagnosis.schema.js';
import type { DiagnosisClient } from '../diagnosis/openai.js';
import { PROMPT_VERSION, type ChatMessage } from '../diagnosis/prompt.js';
import { scenarios } from '../ingest/scenarios/index.js';
import { seedScenarios } from '../ingest/seed.js';
import { runEval } from './runner.js';

// Integration test against a real Postgres (DATABASE_URL must point at a test database). It proves the
// runner plumbing end to end: seed every scenario, investigate each by key with a deterministic stub,
// read the produced diagnosis back from the persisted Investigation, and score it — no OPENAI_API_KEY
// or network. The scoring logic's "teeth" live in the pure scorers.test.ts; this file verifies the
// wiring (persistence round-trip + accounting) around it.

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
 * A stub that reads the event id out of the investigation-request message, looks up the scenario, and
 * returns a diagnosis whose category matches the ground-truth label (and refuses, speculatively, on
 * the insufficient_evidence case). Enough to prove the persisted category + diagnosis Json round-trip
 * into the scorecard; it is not a model and does not run the toolkit.
 */
function scenarioAwareStub(): DiagnosisClient {
  return {
    async runDiagnosis(messages: ChatMessage[]) {
      const last = messages.at(-1);
      const content = last?.role === 'user' ? last.content : '';
      const key = /eventId: (\S+)/.exec(content)?.[1] ?? '';
      const scenario = scenarios.find((s) => s.key === key);
      const category = scenario?.expected.category ?? 'insufficient_evidence';
      const isSpeculative = category === 'insufficient_evidence';

      const diagnosis: Diagnosis = {
        failureCategory: category,
        rootCause: 'stubbed diagnosis',
        confidence: isSpeculative ? 0.3 : 0.9,
        evidence: isSpeculative
          ? []
          : [{ field: 'attempts[0].responseStatus', value: 'stub', note: 'stub' }],
        remediationSteps: ['stub'],
        reachabilityAssessment: 'unknown',
        isSpeculative,
      };

      return {
        diagnosis,
        usage: { promptTokens: 100, completionTokens: 20 },
        model: 'stub-model',
        toolCalls: [],
      };
    },
  };
}

describe('runEval', () => {
  it('investigates every seeded scenario and returns a well-formed scorecard with accounting', async () => {
    await seedScenarios();

    const { runs, scorecard } = await runEval({ client: scenarioAwareStub() });

    // One run per labeled scenario, each carrying the accounting the CLAUDE.md rule requires.
    expect(runs).toHaveLength(scenarios.length);
    expect(scorecard.total).toBe(scenarios.length);
    for (const run of runs) {
      expect(run.promptVersion).toBe(PROMPT_VERSION);
      expect(run.model).toBe('stub-model');
      expect(run.promptTokens).toBe(100);
      expect(run.completionTokens).toBe(20);
      expect(typeof run.costUsd).toBe('string');
    }

    // The stub matches every ground-truth category, so classification round-trips to perfect accuracy;
    // the insufficient_evidence refusal round-trips as grounded.
    expect(scorecard.classification.accuracy).toBe(1);
    const insufficient = scorecard.scenarios.find(
      (s) => s.expectedCategory === 'insufficient_evidence',
    );
    expect(insufficient?.grounded).toBe(true);
  });

  it('throws when a scenario is not seeded', async () => {
    await expect(runEval({ client: scenarioAwareStub() })).rejects.toThrow(/not seeded/);
  });
});
