import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DbClient } from '@patchwork/db';
import type { GitHubAppAuth } from './github/auth.js';
import type { GitHubClient } from './github/client.js';
import type { CookiePolicy } from './plugins/cookies.js';
import { registerSessionPlugin } from './plugins/session.js';
import { registerAnalysesRoutes } from './routes/analyses.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerGitHubRoutes } from './routes/github.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImpactAssessmentsRoutes } from './routes/impact-assessments.js';
import { registerReadyRoutes } from './routes/ready.js';

export interface AppDeps {
  db: DbClient;
  logLevel: string;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
  githubClientId: string;
  githubClientSecret: string;
  githubAppSlug: string;
  cookiePolicy: CookiePolicy;
  webAppUrl: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: deps.logLevel },
    genReqId: (request) => (request.headers['x-request-id'] as string | undefined) ?? randomUUID(),
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'unhandled request error');

    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      error: statusCode === 500 ? 'Internal Server Error' : error.name,
      message: statusCode === 500 ? 'An unexpected error occurred.' : error.message,
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found.`,
      requestId: request.id,
    });
  });

  registerSessionPlugin(app, { db: deps.db.db });

  registerHealthRoutes(app);
  registerReadyRoutes(app, { db: deps.db });
  registerAuthRoutes(app, {
    db: deps.db.db,
    githubClient: deps.githubClient,
    githubClientId: deps.githubClientId,
    githubClientSecret: deps.githubClientSecret,
    cookiePolicy: deps.cookiePolicy,
    webAppUrl: deps.webAppUrl,
  });
  registerGitHubRoutes(app, {
    db: deps.db.db,
    githubClient: deps.githubClient,
    githubAppAuth: deps.githubAppAuth,
    githubAppSlug: deps.githubAppSlug,
    cookiePolicy: deps.cookiePolicy,
    webAppUrl: deps.webAppUrl,
  });
  registerAnalysesRoutes(app, {
    db: deps.db.db,
    githubClient: deps.githubClient,
    githubAppAuth: deps.githubAppAuth,
  });
  registerImpactAssessmentsRoutes(app, {
    db: deps.db.db,
    githubClient: deps.githubClient,
    githubAppAuth: deps.githubAppAuth,
  });

  return app;
}
