import { FailureCategory } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { FAILURE_CATEGORIES } from './failure-category.js';

describe('failure taxonomy', () => {
  it('stays in lock-step with the Prisma FailureCategory enum', () => {
    // Guards against drift: adding a value to the Prisma enum (or this array)
    // without updating the other will fail here.
    expect([...FAILURE_CATEGORIES].sort()).toEqual(Object.values(FailureCategory).sort());
  });

  it('has exactly eight categories', () => {
    expect(FAILURE_CATEGORIES).toHaveLength(8);
  });
});
