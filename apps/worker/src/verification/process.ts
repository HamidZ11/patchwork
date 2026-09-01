import type { Logger } from 'pino';
import type { Database } from '@patchwork/db';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { claimNextPendingRun, recoverStaleClaims } from './queue.js';
import { getPatchAttemptForVerification, completeVerificationRun } from './persistence.js';
import { runVerification } from './run.js';
import type { SandboxRunner } from './sandbox-runner.js';

export interface ProcessDeps {
  db: Database;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
  sandboxRunner: SandboxRunner;
  logger: Logger;
  workerId: string;
}

/**
 * One poll cycle: recover any stale (crashed-worker) leases, then claim
 * and fully process at most one PENDING VerificationRun. Returns `true`
 * if a run was claimed and processed (so the caller can poll again
 * immediately instead of waiting for the next interval), `false` if the
 * queue was empty.
 */
export async function processNextPendingRun(deps: ProcessDeps): Promise<boolean> {
  const recovered = await recoverStaleClaims(deps.db);
  if (recovered > 0) {
    deps.logger.warn({ recovered }, 'recovered stale verification run lease(s)');
  }

  const claimed = await claimNextPendingRun(deps.db, deps.workerId);
  if (!claimed) return false;

  deps.logger.info({ verificationRunId: claimed.id }, 'claimed verification run');

  try {
    const patchAttempt = await getPatchAttemptForVerification(deps.db, claimed.patchAttemptId);
    if (!patchAttempt) {
      await completeVerificationRun(
        deps.db,
        claimed.id,
        {
          status: 'INFRA_ERROR',
          failureCategory: 'SANDBOX_INFRA_FAILURE',
          failureReason: 'patch attempt referenced by this verification run no longer exists',
          steps: [],
          sandboxRuntime: null,
        },
        null,
      );
      return true;
    }

    const { outcome, manifest } = await runVerification(patchAttempt, {
      sandboxRunner: deps.sandboxRunner,
      githubClient: deps.githubClient,
      githubAppAuth: deps.githubAppAuth,
    });

    await completeVerificationRun(deps.db, claimed.id, outcome, manifest);
    deps.logger.info(
      { verificationRunId: claimed.id, status: outcome.status },
      'verification run completed',
    );
  } catch (error) {
    deps.logger.error(
      { err: error, verificationRunId: claimed.id },
      'verification run failed unexpectedly',
    );
    await completeVerificationRun(
      deps.db,
      claimed.id,
      {
        status: 'INFRA_ERROR',
        failureCategory: 'SANDBOX_INFRA_FAILURE',
        failureReason:
          error instanceof Error ? error.message : 'unexpected error running verification',
        steps: [],
        sandboxRuntime: null,
      },
      null,
    );
  }

  return true;
}
