import type { FastifyInstance } from 'fastify';
import type { Database } from '@patchwork/db';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import {
  checkOfflineEligibility,
  createPendingPullRequestAttempt,
  getPullRequestAttemptForUser,
  getPullRequestAttemptsForPatchAttempt,
  getVerificationRunForPublish,
  isActiveStatus,
} from '../pull-requests/persistence.js';
import { requireAuth } from '../plugins/session.js';

export interface PullRequestAttemptsRoutesDeps {
  db: Database;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
}

/**
 * Trusted-layer half of GitHub publication -- authenticates, ownership-
 * scopes the VerificationRun, re-checks every offline eligibility rule
 * (PatchAttempt GENERATED, VerificationRun PASSED, verified-diff-hash
 * match, no forbidden files), and enqueues the work by inserting a
 * PENDING pull_request_attempts row -- apps/worker's poll loop (see
 * apps/worker/src/pull-requests/) does the one live-GitHub check this
 * route deliberately doesn't (current default branch HEAD) and performs
 * the actual branch/commit/PR writes. This route never creates a branch,
 * commit, or PR itself, and never sees an installation token used for a
 * write -- it only authorizes, enqueues, and (for the one case that
 * needs a cheap live read -- an existing OPENED attempt) checks whether
 * a previously-opened PR is still open. The request body carries no
 * branch name, base SHA, file paths, commit contents, diff text, or PR
 * body -- every one of those is server-derived from already-persisted,
 * already-verified state.
 */
export function registerPullRequestAttemptsRoutes(
  app: FastifyInstance,
  deps: PullRequestAttemptsRoutesDeps,
): void {
  app.post<{ Params: { id: string } }>(
    '/verification-runs/:id/pull-requests',
    { preHandler: requireAuth },
    async (request, reply) => {
      const verificationRun = await getVerificationRunForPublish(
        deps.db,
        request.user!.id,
        request.params.id,
      );
      if (!verificationRun) {
        return reply
          .status(404)
          .send({ error: 'Not Found', message: 'Verification run not found.' });
      }

      const eligibility = checkOfflineEligibility(verificationRun);
      if (eligibility.kind === 'refused') {
        return reply.status(409).send({ error: 'Conflict', message: eligibility.reason });
      }

      const existingAttempts = await getPullRequestAttemptsForPatchAttempt(
        deps.db,
        verificationRun.patchAttemptId,
      );

      const inFlight = existingAttempts.find((attempt) => isActiveStatus(attempt.status));
      if (inFlight) {
        return reply.status(200).send({ pullRequestAttempt: inFlight, alreadyInFlight: true });
      }

      const openedAttempt = existingAttempts.find((attempt) => attempt.status === 'OPENED');
      if (openedAttempt && openedAttempt.githubPrNumber !== null) {
        let livePr;
        try {
          const installationToken = await deps.githubAppAuth.getInstallationToken(
            verificationRun.githubInstallationId,
          );
          livePr = await deps.githubClient.getPullRequest(
            verificationRun.repositoryOwner,
            verificationRun.repositoryName,
            openedAttempt.githubPrNumber,
            installationToken,
          );
        } catch (error) {
          request.log.error({ err: error }, 'failed to check the previous pull request on GitHub');
          return reply.status(502).send({
            error: 'Bad Gateway',
            message: 'Could not verify the previous pull request’s status on GitHub.',
          });
        }

        if (livePr.state === 'open') {
          return reply
            .status(200)
            .send({ pullRequestAttempt: openedAttempt, alreadyInFlight: true });
        }

        return reply.status(409).send({
          error: 'Conflict',
          message: `The previous Patchwork pull request (#${openedAttempt.githubPrNumber}) is no longer open (${livePr.merged ? 'merged' : 'closed'}). Publishing again is not supported yet.`,
          pullRequestAttempt: openedAttempt,
        });
      }

      const created = await createPendingPullRequestAttempt(deps.db, {
        patchAttemptId: verificationRun.patchAttemptId,
        verificationRunId: verificationRun.id,
      });

      return reply.status(201).send({
        pullRequestAttempt: {
          id: created.id,
          status: created.status,
          createdAt: created.createdAt,
        },
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/pull-request-attempts/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const attempt = await getPullRequestAttemptForUser(
        deps.db,
        request.user!.id,
        request.params.id,
      );
      if (!attempt) {
        return reply
          .status(404)
          .send({ error: 'Not Found', message: 'Pull request attempt not found.' });
      }

      return reply.send({ pullRequestAttempt: attempt });
    },
  );
}
