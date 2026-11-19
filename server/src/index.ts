import type { Server } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/client.js';
import { logger } from './logging/logger.js';

const port = env.PORT;

// Bind 0.0.0.0 implicitly (Express default) so the container is reachable; Railway injects PORT.
const server: Server = app.listen(port, () => {
  logger.info({ port }, `server listening on http://localhost:${port}`);
});

// Graceful shutdown (Phase 10, B9): on a platform redeploy/stop the orchestrator sends SIGTERM (SIGINT
// on Ctrl-C locally). Stop accepting new connections, let in-flight requests drain, then close the DB
// pool — so a redeploy doesn't sever live requests or leak Postgres connections. A hard timeout forces
// exit if a connection hangs, so shutdown can't wedge the deploy.
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forced = setTimeout(() => {
    logger.error('forced shutdown: connections did not drain in time');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forced.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await prisma.$disconnect();
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error(
      err instanceof Error ? { err: { message: err.message, stack: err.stack } } : { err },
      'error during shutdown',
    );
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal));
}
