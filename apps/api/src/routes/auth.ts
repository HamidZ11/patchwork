import type { FastifyInstance } from 'fastify';
import type { Database } from '@patchwork/db';
import type { GitHubClient } from '../github/client.js';
import { findOrCreateUserByGitHubProfile } from '../auth/users.js';
import { createSession, deleteSession } from '../auth/sessions.js';
import { clearCookie, getCookie, setCookie, type CookiePolicy } from '../plugins/cookies.js';
import { generateAndSetState, validateAndConsumeState } from '../plugins/oauth-state.js';
import { requireAuth, SESSION_COOKIE_NAME } from '../plugins/session.js';

const OAUTH_STATE_COOKIE = 'gh_oauth_state';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface AuthRoutesDeps {
  db: Database;
  githubClient: GitHubClient;
  githubClientId: string;
  githubClientSecret: string;
  cookiePolicy: CookiePolicy;
  webAppUrl: string;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  app.get('/auth/github/login', async (_request, reply) => {
    const state = generateAndSetState(reply, OAUTH_STATE_COOKIE, deps.cookiePolicy);
    const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', deps.githubClientId);
    authorizeUrl.searchParams.set('state', state);
    return reply.redirect(authorizeUrl.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/github/callback',
    async (request, reply) => {
      const errorRedirect = (code: string) => reply.redirect(withError(deps.webAppUrl, code));

      if (request.query.error) return errorRedirect('oauth_denied');

      const stateValid = validateAndConsumeState(
        request,
        reply,
        OAUTH_STATE_COOKIE,
        request.query.state,
        deps.cookiePolicy,
      );
      if (!stateValid || !request.query.code) return errorRedirect('oauth_failed');

      try {
        const userAccessToken = await deps.githubClient.exchangeOAuthCode({
          clientId: deps.githubClientId,
          clientSecret: deps.githubClientSecret,
          code: request.query.code,
        });
        const profile = await deps.githubClient.getAuthenticatedUser(userAccessToken);
        // The user access token is never persisted or logged -- it goes out
        // of scope here and is discarded.

        const user = await findOrCreateUserByGitHubProfile(deps.db, profile);
        const { token } = await createSession(deps.db, user.id);

        setCookie(reply, SESSION_COOKIE_NAME, token, {
          maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
          ...deps.cookiePolicy,
        });

        return reply.redirect(new URL('/repositories', deps.webAppUrl).toString());
      } catch (error) {
        request.log.error({ err: error }, 'github oauth callback failed');
        return errorRedirect('oauth_failed');
      }
    },
  );

  app.get('/auth/me', { preHandler: requireAuth }, async (request) => {
    return { user: request.user };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = getCookie(request, SESSION_COOKIE_NAME);
    if (token) await deleteSession(deps.db, token);
    clearCookie(reply, SESSION_COOKIE_NAME, deps.cookiePolicy);
    return reply.status(204).send();
  });
}

function withError(webAppUrl: string, code: string): string {
  const url = new URL('/', webAppUrl);
  url.searchParams.set('error', code);
  return url.toString();
}
