import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { DbClient } from '@patchwork/db';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { processNextPendingPullRequestAttempt } from './pull-requests/process.js';
import type { SandboxRunner } from './verification/sandbox-runner.js';
import { processNextPendingRun } from './verification/process.js';

const POLL_INTERVAL_MS = 3_000;

export interface WorkerDeps {
  db: DbClient;
  logger: Logger;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
  githubAppSlug: string;
  sandboxRunner: SandboxRunner;
}

export interface Worker {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Polls verification_runs and pull_request_attempts for PENDING work
 * every POLL_INTERVAL_MS (see verification/queue.ts's claimNextPendingRun
 * and pull-requests/queue.ts's claimNextPendingPullRequestAttempt --
 * Postgres `SELECT ... FOR UPDATE SKIP LOCKED` on each table, not a
 * separate queue system) and processes at most one item per tick
 * (verification checked first, pull-request publishing only if none was
 * found), immediately polling again if one was found (drains a backlog
 * faster than waiting a full interval between every item) rather than
 * waiting a full interval between every item. Graceful shutdown waits
 * for any in-flight item to finish persisting before closing the DB
 * connection -- SIGTERM/SIGINT mid-run should not corrupt its result.
 */
export function createWorker(deps: WorkerDeps): Worker {
  const workerId = `worker-${randomUUID()}`;
  let stopping = false;
  let pollTimer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;

  async function tick(): Promise<void> {
    if (stopping) return;
    try {
      const processedVerification = await processNextPendingRun({
        db: deps.db.db,
        githubClient: deps.githubClient,
        githubAppAuth: deps.githubAppAuth,
        sandboxRunner: deps.sandboxRunner,
        logger: deps.logger,
        workerId,
      });
      const processedPullRequest = processedVerification
        ? false
        : await processNextPendingPullRequestAttempt({
            db: deps.db.db,
            githubClient: deps.githubClient,
            githubAppAuth: deps.githubAppAuth,
            appSlug: deps.githubAppSlug,
            logger: deps.logger,
            workerId,
          });
      if ((processedVerification || processedPullRequest) && !stopping) {
        inFlight = tick();
        await inFlight;
        return;
      }
    } catch (error) {
      deps.logger.error({ err: error }, 'error while polling for worker queue work');
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
