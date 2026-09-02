import type { Logger } from 'pino';
import type { Database } from '@patchwork/db';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import {
  completePullRequestAttempt,
  getPublishContext,
  getPullRequestAttemptsForPatchAttempt,
} from './persistence.js';
import { claimNextPendingPullRequestAttempt, recoverStalePullRequestClaims } from './queue.js';
import { publishPullRequest } from './run.js';
import type { PublishOutcome } from './types.js';

export interface PullRequestProcessDeps {
  db: Database;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
  appSlug: string;
  logger: Logger;
  workerId: string;
}

function infraFailure(reason: string): PublishOutcome {
  return {
    status: 'FAILED',
    failureCategory: 'GITHUB_API_FAILURE',
    failureReason: reason,
    branchName: null,
    commitSha: null,
    githubPrNumber: null,
    githubPrUrl: null,
  };
}

/**
 * Claims and processes at most one PENDING pull_request_attempts row --
 * same claim/recover/complete shape as verification/process.ts's
 * processNextPendingRun, applied to publishing instead of sandbox
 * verification. Returns true if work was found (so the poll loop can
 * immediately check for more), false if the queue was empty.
 */
export async function processNextPendingPullRequestAttempt(
  deps: PullRequestProcessDeps,
): Promise<boolean> {
  const recovered = await recoverStalePullRequestClaims(deps.db);
  if (recovered > 0) {
    deps.logger.warn({ recovered }, 'recovered stale pull request attempt lease(s)');
  }

  const claimed = await claimNextPendingPullRequestAttempt(deps.db, deps.workerId);
  if (!claimed) return false;

  deps.logger.info({ pullRequestAttemptId: claimed.id }, 'claimed pull request attempt');

  try {
    const context = await getPublishContext(deps.db, claimed.id);
    if (!context) {
      await completePullRequestAttempt(
        deps.db,
        claimed.id,
        infraFailure(
          'could not load the patch attempt / verification run context for this pull request attempt',
        ),
      );
      return true;
    }

    const priorAttempts = await getPullRequestAttemptsForPatchAttempt(
      deps.db,
      context.patchAttemptId,
    );
    const priorCommitShas = priorAttempts
      .filter((attempt) => attempt.id !== claimed.id && attempt.commitSha !== null)
      .map((attempt) => attempt.commitSha as string);

    const outcome = await publishPullRequest(context, {
      githubClient: deps.githubClient,
      githubAppAuth: deps.githubAppAuth,
      appSlug: deps.appSlug,
      priorCommitShas,
    });
    await completePullRequestAttempt(deps.db, claimed.id, outcome);
    deps.logger.info(
      { pullRequestAttemptId: claimed.id, status: outcome.status },
      'pull request attempt completed',
    );
  } catch (error) {
    deps.logger.error(
      { err: error, pullRequestAttemptId: claimed.id },
      'pull request attempt failed unexpectedly',
    );
    await completePullRequestAttempt(
      deps.db,
      claimed.id,
      infraFailure(
        error instanceof Error ? `unexpected error: ${error.message}` : 'unexpected error',
      ),
    );
  }
  return true;
}
