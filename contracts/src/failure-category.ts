// The failure taxonomy — the single cross-workspace source of truth, shared by the server (Zod
// diagnosis schema, API validation) and the web UI (category badges, filters). Kept Prisma-free so
// this package stays dependency-light and resolvable from both workspaces: the server's
// failure-category.test.ts asserts this tuple stays in lock-step with the Prisma `FailureCategory`
// enum, which is where the DB-side coupling is verified.

export const FAILURE_CATEGORIES = [
  'authentication',
  'payload_validation',
  'timeout',
  'network_failure',
  'rate_limit',
  'server_error',
  'application_logic',
  'insufficient_evidence',
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];
