import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

// A single PrismaClient per process. Under `tsx watch` the module graph is
// re-evaluated on reload, so we cache the instance on globalThis to avoid
// exhausting the connection pool with a new client on every hot reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
