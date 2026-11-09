import { describe, expect, it } from 'vitest';
import { FAILURE_CATEGORIES } from '../domain/failure-category.js';
import { DiagnosisSchema, type Diagnosis } from './diagnosis.schema.js';

const validDiagnosis: Diagnosis = {
  failureCategory: 'authentication',
  rootCause: 'Rejected 401 with an expired-key error code.',
  confidence: 0.95,
  evidence: [{ field: 'attempts[0].responseStatus', value: '401', note: 'Unauthorized.' }],
  remediationSteps: ['Rotate the API key.'],
  reachabilityAssessment: 'reachable',
  isSpeculative: false,
};

describe('DiagnosisSchema', () => {
  it('derives its category enum in lock-step with FAILURE_CATEGORIES', () => {
    // Single-sourced taxonomy: the schema enum must be exactly FAILURE_CATEGORIES, so adding a
    // category in one place without the other fails here (and failure-category.test keeps that
    // array locked to the Prisma enum in turn).
    expect(DiagnosisSchema.shape.failureCategory.options).toEqual([...FAILURE_CATEGORIES]);
  });

  it('parses a well-formed diagnosis', () => {
    expect(DiagnosisSchema.safeParse(validDiagnosis).success).toBe(true);
  });

  it('rejects a category outside the taxonomy', () => {
    const parsed = DiagnosisSchema.safeParse({
      ...validDiagnosis,
      failureCategory: 'not_a_category',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects confidence outside [0,1]', () => {
    expect(DiagnosisSchema.safeParse({ ...validDiagnosis, confidence: 1.5 }).success).toBe(false);
    expect(DiagnosisSchema.safeParse({ ...validDiagnosis, confidence: -0.1 }).success).toBe(false);
  });

  it('rejects a malformed evidence entry', () => {
    const parsed = DiagnosisSchema.safeParse({
      ...validDiagnosis,
      evidence: [{ field: 'attempts[0].responseStatus', value: '401' }], // missing `note`
    });
    expect(parsed.success).toBe(false);
  });

  it('requires every field (no optionals — Structured-Outputs-safe)', () => {
    const { isSpeculative: _omit, ...withoutSpeculative } = validDiagnosis;
    expect(DiagnosisSchema.safeParse(withoutSpeculative).success).toBe(false);
  });
});
