import type { FailureCategory } from '@prisma/client';

/**
 * The failure taxonomy — the single JS-side source of truth. The Phase 4 Zod
 * diagnosis schema derives its enum from this array, and a test asserts it stays
 * in lock-step with the Prisma `FailureCategory` enum (see failure-category.test.ts).
 */
export const FAILURE_CATEGORIES = [
  'authentication',
  'payload_validation',
  'timeout',
  'network_failure',
  'rate_limit',
  'server_error',
  'application_logic',
  'insufficient_evidence',
] as const satisfies readonly FailureCategory[];

export type FailureCategoryValue = (typeof FAILURE_CATEGORIES)[number];
