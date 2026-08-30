import type { Logger } from 'pino';
import type { DbClient } from '@patchwork/db';

export interface WorkerDeps {
  db: DbClient;
  logger: Logger;
}

export interface Worker {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Foundation-only worker process. It proves out shared config/db wiring and
 * graceful lifecycle management; it does not yet run any background jobs.
 */
export function createWorker(deps: WorkerDeps): Worker {
  return {
    start: async () => {
      await deps.db.ping();
      deps.logger.info('worker started');
    },
    stop: async () => {
      await deps.db.close();
      deps.logger.info('worker stopped');
    },
  };
}
