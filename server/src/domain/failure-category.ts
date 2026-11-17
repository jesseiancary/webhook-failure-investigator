// The failure taxonomy now lives in @wfi/contracts (Prisma-free, shared with the web UI). This
// module re-exports it under the server's historical names so existing importers are unchanged.
import type { FailureCategory as PrismaFailureCategory } from '@prisma/client';
import { FAILURE_CATEGORIES } from '@wfi/contracts';

// Compile-time lock-step guard — kept here (server side) rather than in the Prisma-free contracts
// package: every taxonomy value must be a member of the Prisma `FailureCategory` enum, so a typo or a
// value that diverges from the DB enum fails `tsc` immediately. failure-category.test.ts adds the
// reverse direction (no Prisma enum value is missing from the tuple) at runtime.
const _categoriesArePrismaValues: readonly PrismaFailureCategory[] = FAILURE_CATEGORIES;
void _categoriesArePrismaValues;

export { FAILURE_CATEGORIES };
export type { FailureCategory as FailureCategoryValue } from '@wfi/contracts';
