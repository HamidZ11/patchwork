import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { DbClient } from '@patchwork/db';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import type { SandboxRunner } from './verification/sandbox-runner.js';
import { processNextPendingRun } from './verification/process.js';

const POLL_INTERVAL_MS = 3_000;

export interface WorkerDeps {
  db: DbClient;
  logger: Logger;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
  sandboxRunner: SandboxRunner;
}

export interface Worker {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Polls verification_runs for PENDING work every POLL_INTERVAL_MS (see
 * verification/queue.ts's claimNextPendingRun -- Postgres `SELECT ...
 * FOR UPDATE SKIP LOCKED`, not a separate queue system) and processes at
 * most one run per tick, immediately polling again if one was found
 * (drains a backlog faster than waiting a full interval between every
 * item) rather than waiting a full interval between every item.
 * Graceful shutdown waits for any in-flight run to finish persisting
 * before closing the DB connection -- SIGTERM/SIGINT during a sandbox
 * run should not corrupt that run's result.
 */
export function createWorker(deps: WorkerDeps): Worker {
  const workerId = `worker-${randomUUID()}`;
  let stopping = false;
  let pollTimer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;

  async function tick(): Promise<void> {
    if (stopping) return;
    try {
      const processed = await processNextPendingRun({
        db: deps.db.db,
        githubClient: deps.githubClient,
        githubAppAuth: deps.githubAppAuth,
        sandboxRunner: deps.sandboxRunner,
        logger: deps.logger,
        workerId,
      });
      if (processed && !stopping) {
        inFlight = tick();
        await inFlight;
        return;
      }
    } catch (error) {
      deps.logger.error({ err: error }, 'error while polling for verification work');
    }
    if (!stopping) {
      pollTimer = setTimeout(() => {
        inFlight = tick();
      }, POLL_INTERVAL_MS);
    }
  }

  return {
    start: async () => {
      await deps.db.ping();
      deps.logger.info({ workerId }, 'worker started');
      inFlight = tick();
    },
    stop: async () => {
      stopping = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (inFlight) await inFlight;
      await deps.db.close();
      deps.logger.info('worker stopped');
    },
  };
}
