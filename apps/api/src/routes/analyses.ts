import type { FastifyInstance } from 'fastify';
import type { Database } from '@patchwork/db';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { ANALYZER_VERSION } from '../analysis/version.js';
import { resolveRepositorySnapshot } from '../analysis/snapshots.js';
import { collectStripeEvidence } from '../analysis/evidence.js';
import {
  createAnalysisRun,
  getRepositoryForUser,
  upsertSnapshot,
} from '../analysis/persistence.js';
import { requireAuth } from '../plugins/session.js';

export interface AnalysesRoutesDeps {
  db: Database;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
}

/**
 * Triggers resolving a repository's exact current commit SHA, records it
 * as an immutable RepositorySnapshot, then acquires the exact-SHA archive
 * and collects deterministic Stripe/TypeScript applicability evidence
 * (analysis/evidence.ts) -- never a decision about whether any change
 * affects the repository. Kept separate from routes/github.ts, which
 * stays scoped to the GitHub connection/OAuth flow.
 */
export function registerAnalysesRoutes(app: FastifyInstance, deps: AnalysesRoutesDeps): void {
  app.post<{ Params: { id: string } }>(
    '/repositories/:id/analyses',
    { preHandler: requireAuth },
    async (request, reply) => {
      const repository = await getRepositoryForUser(deps.db, request.user!.id, request.params.id);
      if (!repository) {
        return reply.status(404).send({ error: 'Not Found', message: 'Repository not found.' });
      }

      const startedAt = new Date();

      let resolved;
      try {
        // installationId/owner/name come from our own stored, authorized
        // record -- never from caller input.
        resolved = await resolveRepositorySnapshot(
          {
            owner: repository.owner,
            name: repository.name,
            defaultBranch: repository.defaultBranch,
            githubInstallationId: repository.githubInstallationId,
          },
          { client: deps.githubClient, appAuth: deps.githubAppAuth },
        );
      } catch (error) {
        // Fail closed: no snapshot, no run persisted -- same convention as
        // the install callback's GitHub-boundary failure handling. Unlike
        // evidence collection below, SHA resolution failing means there is
        // nothing to attach a run to yet.
        request.log.error({ err: error }, 'failed to resolve repository snapshot');
        return reply.status(502).send({
          error: 'Bad Gateway',
          message: 'Could not resolve the repository state from GitHub.',
        });
      }

      const snapshot = await upsertSnapshot(deps.db, {
        repositoryId: repository.id,
        commitSha: resolved.commitSha,
        ref: resolved.ref,
        acquisitionMethod: resolved.acquisitionMethod,
      });

      let evidenceOutcome:
        | { status: 'completed'; evidence: Awaited<ReturnType<typeof collectStripeEvidence>> }
        | { status: 'failed' };
      try {
        const evidence = await collectStripeEvidence(
          {
            owner: repository.owner,
            name: repository.name,
            commitSha: resolved.commitSha,
            githubInstallationId: repository.githubInstallationId,
          },
          { client: deps.githubClient, appAuth: deps.githubAppAuth },
        );
        evidenceOutcome = { status: 'completed', evidence };
      } catch (error) {
        // The snapshot is already recorded (it's valid regardless of
        // whether evidence collection succeeds) -- record a 'failed' run
        // rather than silently discarding that a trigger happened. Not a
        // 5xx: the trigger itself succeeded.
        request.log.error({ err: error }, 'failed to collect stripe evidence');
        evidenceOutcome = { status: 'failed' };
      }

      const { analysisRun, evidence } = await createAnalysisRun(deps.db, {
        repositorySnapshotId: snapshot.id,
        triggeredByUserId: request.user!.id, // requireAuth guarantees this
        analyzerVersion: ANALYZER_VERSION,
        startedAt,
        completedAt: new Date(),
        ...evidenceOutcome,
      });

      return reply.status(201).send({ analysisRun, snapshot, evidence });
    },
  );
}
