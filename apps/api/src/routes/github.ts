import type { FastifyInstance } from 'fastify';
import type { Database } from '@patchwork/db';
import type { GitHubClient } from '../github/client.js';
import type { GitHubAppAuth } from '../github/auth.js';
import { syncInstallation } from '../github/installations.js';
import {
  getRepositoriesForUser,
  upsertInstallationAndRepositories,
} from '../github/persistence.js';
import { getLatestAnalysisForRepositories } from '../analysis/persistence.js';
import { getImpactAssessmentsForAnalysisRuns } from '../analysis/impact-persistence.js';
import type { CookiePolicy } from '../plugins/cookies.js';
import { generateAndSetState, validateAndConsumeState } from '../plugins/oauth-state.js';
import { requireAuth } from '../plugins/session.js';

const INSTALL_STATE_COOKIE = 'gh_install_state';

export interface GitHubRoutesDeps {
  db: Database;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
  githubAppSlug: string;
  cookiePolicy: CookiePolicy;
  webAppUrl: string;
}

export function registerGitHubRoutes(app: FastifyInstance, deps: GitHubRoutesDeps): void {
  app.get('/github/install', { preHandler: requireAuth }, async (_request, reply) => {
    const state = generateAndSetState(reply, INSTALL_STATE_COOKIE, deps.cookiePolicy);
    const installUrl = new URL(`https://github.com/apps/${deps.githubAppSlug}/installations/new`);
    installUrl.searchParams.set('state', state);
    return reply.redirect(installUrl.toString());
  });

  app.get<{ Querystring: { installation_id?: string; setup_action?: string; state?: string } }>(
    '/github/install/callback',
    { preHandler: requireAuth },
    async (request, reply) => {
      const errorRedirect = (code: string) => reply.redirect(withError(deps.webAppUrl, code));

      // Pending org-admin approval: GitHub grants no installation yet.
      if (request.query.setup_action === 'request') {
        return errorRedirect('install_pending_approval');
      }

      const stateValid = validateAndConsumeState(
        request,
        reply,
        INSTALL_STATE_COOKIE,
        request.query.state,
        deps.cookiePolicy,
      );
      if (!stateValid) return errorRedirect('install_state_invalid');

      const installationId = Number(request.query.installation_id);
      if (!request.query.installation_id || Number.isNaN(installationId)) {
        return errorRedirect('install_failed');
      }

      try {
        // installation_id from the query string is never trusted directly --
        // syncInstallation independently re-verifies it against GitHub.
        const { installation, repositories } = await syncInstallation(installationId, {
          client: deps.githubClient,
          appAuth: deps.githubAppAuth,
        });

        await upsertInstallationAndRepositories(deps.db, {
          installation,
          repositories,
          connectedByUserId: request.user!.id, // requireAuth guarantees this
        });

        return reply.redirect(new URL('/repositories', deps.webAppUrl).toString());
      } catch (error) {
        request.log.error({ err: error }, 'github install callback failed');
        return errorRedirect('install_failed');
      }
    },
  );

  app.get('/repositories', { preHandler: requireAuth }, async (request) => {
    const repositories = await getRepositoriesForUser(deps.db, request.user!.id);
    const latestAnalysisByRepo = await getLatestAnalysisForRepositories(
      deps.db,
      repositories.map((repo) => repo.id),
    );
    const latestImpactAssessmentByRun = await getImpactAssessmentsForAnalysisRuns(
      deps.db,
      [...latestAnalysisByRepo.values()].map((analysis) => analysis.analysisRunId),
    );

    return {
      repositories: repositories.map((repo) => {
        const latestAnalysis = latestAnalysisByRepo.get(repo.id) ?? null;
        return {
          ...repo,
          latestAnalysis: latestAnalysis
            ? {
                ...latestAnalysis,
                latestImpactAssessments:
                  latestImpactAssessmentByRun.get(latestAnalysis.analysisRunId) ?? [],
              }
            : null,
        };
      }),
    };
  });
}

function withError(webAppUrl: string, code: string): string {
  const url = new URL('/', webAppUrl);
  url.searchParams.set('error', code);
  return url.toString();
}
