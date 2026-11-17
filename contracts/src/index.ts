// @wfi/contracts — the single, Prisma-free source of truth for the web↔server contract: the Zod
// schemas that drive both API validation and OpenAI structured output, the failure taxonomy, and the
// serialized HTTP wire types the React UI consumes. Imported by both @wfi/server and @wfi/web.

export * from './failure-category.js';
export * from './diagnosis.schema.js';
export * from './submission.schema.js';
export * from './wire.js';
