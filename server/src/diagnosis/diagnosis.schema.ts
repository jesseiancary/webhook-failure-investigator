import { z } from 'zod';
import { FAILURE_CATEGORIES } from '../domain/failure-category.js';

// The structured-output contract for a single diagnosis. Per CLAUDE.md's "single-source shapes"
// rule this one Zod schema is reused everywhere a diagnosis is shaped — it drives OpenAI
// Structured Outputs (PR2, via `zodResponseFormat`) and any API-side validation. It mirrors
// PLAN §5.1 and derives its category enum from FAILURE_CATEGORIES so the taxonomy stays
// single-sourced (a test locks it to the Prisma enum).
//
// Structured-Outputs-safe: every field is REQUIRED. OpenAI's parser needs a closed, fully
// specified object, so never add `.optional()` here — if a field ever becomes genuinely absent,
// make it `.nullable()` instead so it stays present-but-null in the contract.

/** One grounded citation: a real log field, its observed value, and why it supports the cause. */
export const EvidenceSchema = z.object({
  /** The exact field path cited from the serialized logs, e.g. `attempts[0].responseStatus`. */
  field: z.string(),
  /** The observed value at that path (stringified for a stable, model-friendly contract). */
  value: z.string(),
  /** Why this observation supports the root cause. */
  note: z.string(),
});

/**
 * Whether the receiving endpoint was reachable at all. Separates a network/DNS fault
 * (`unreachable`) from an endpoint that answered with an error (`reachable`); `unknown` when the
 * logs don't say.
 */
export const ReachabilitySchema = z.enum(['reachable', 'unreachable', 'unknown']);

/** A structured, grounded diagnosis of one failed webhook delivery. */
export const DiagnosisSchema = z.object({
  /** The failure taxonomy bucket (single-sourced from FAILURE_CATEGORIES). */
  failureCategory: z.enum(FAILURE_CATEGORIES),
  /** Plain-language explanation of what went wrong. */
  rootCause: z.string(),
  /** Calibrated confidence in the classification, 0–1. */
  confidence: z.number().min(0).max(1),
  /** The log fields the diagnosis is grounded in. Empty only when `insufficient_evidence`. */
  evidence: z.array(EvidenceSchema),
  /** Concrete, actionable fixes. */
  remediationSteps: z.array(z.string()),
  reachabilityAssessment: ReachabilitySchema,
  /** True when the logs are too thin to ground the cause (pairs with `insufficient_evidence`). */
  isSpeculative: z.boolean(),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type Reachability = z.infer<typeof ReachabilitySchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
