import type { FastifyInstance } from 'fastify';
import type { DbClient } from '@patchwork/db';

interface ReadyDeps {
  db: DbClient;
}

export function registerReadyRoutes(app: FastifyInstance, deps: ReadyDeps): void {
  app.get('/ready', async (request, reply) => {
    try {
      await deps.db.ping();
      return { status: 'ok' };
    } catch (error) {
      request.log.error({ err: error }, 'readiness check failed: database unreachable');
      return reply.status(503).send({
        status: 'unavailable',
        reason: 'database unreachable',
      });
    }
  });
}
