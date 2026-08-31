import type { FastifyInstance } from 'fastify';
import type { Database } from '@patchwork/db';
import type { GitHubAppAuth } from '../github/auth.js';
import type { GitHubClient } from '../github/client.js';
import { ANALYZER_VERSION } from '../analysis/version.js';
import { resolveRepositorySnapshot } from '../analysis/snapshots.js';
import { getRepositoryForUser, upsertSnapshotAndCreateRun } from '../analysis/persistence.js';
import { requireAuth } from '../plugins/session.js';

export interface AnalysesRoutesDeps {
  db: Database;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
}

/**
 * Triggers resolving a repository's exact current commit SHA and records
 * an immutable RepositorySnapshot + AnalysisRun. No repository content is
 * read or executed -- only a commit SHA crosses the boundary. Kept
 * separate from routes/github.ts, which stays scoped to the GitHub
 * connection/OAuth flow.
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
        // the install callback's GitHub-boundary failure handling.
        request.log.error({ err: error }, 'failed to resolve repository snapshot');
        return reply.status(502).send({
          error: 'Bad Gateway',
          message: 'Could not resolve the repository state from GitHub.',
        });
      }

      const { snapshot, analysisRun } = await upsertSnapshotAndCreateRun(deps.db, {
        repositoryId: repository.id,
        commitSha: resolved.commitSha,
        ref: resolved.ref,
        acquisitionMethod: resolved.acquisitionMethod,
        analyzerVersion: ANALYZER_VERSION,
        triggeredByUserId: request.user!.id, // requireAuth guarantees this
        startedAt,
        completedAt: new Date(),
      });

      return reply.status(201).send({ analysisRun, snapshot });
    },
  );
}
