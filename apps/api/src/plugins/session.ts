import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '@patchwork/db';
import { getSessionUser } from '../auth/sessions.js';
import type { PatchworkUser } from '../auth/users.js';
import { getCookie } from './cookies.js';

export const SESSION_COOKIE_NAME = 'patchwork_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: PatchworkUser | null;
  }
}

/**
 * Resolves the current session's user (if any) onto every request. Does
 * NOT enforce authentication itself — routes that require a signed-in user
 * must use the `requireAuth` preHandler below. Keeping resolution global
 * but enforcement per-route matches docs/security.md's existing intent:
 * auth middleware applied per-route, not globally bypassed.
 */
export function registerSessionPlugin(app: FastifyInstance, deps: { db: Database }): void {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    const token = getCookie(request, SESSION_COOKIE_NAME);
    request.user = token ? await getSessionUser(deps.db, token) : null;
  });
}

export function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void,
): void {
  if (!request.user) {
    reply.status(401).send({ error: 'Unauthorized', message: 'Sign in required.' });
    return;
  }
  done();
}
