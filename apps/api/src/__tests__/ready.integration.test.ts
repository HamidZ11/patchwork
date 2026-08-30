import { afterAll, describe, expect, it } from 'vitest';
import { loadEnv } from '@patchwork/config';
import { createDbClient, type DbClient } from '@patchwork/db';
import { buildApp } from '../app.js';
import { testAppDeps } from './fixtures.js';

// Verifies /ready against a real PostgreSQL instance (see docs/testing.md).
describe('GET /ready (real database)', () => {
  const env = loadEnv();
  const db: DbClient = createDbClient(env.DATABASE_URL);

  afterAll(async () => {
    await db.close();
  });

  it('returns 200 when PostgreSQL is actually reachable', async () => {
    const app = buildApp(testAppDeps({ db }));

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
  });
});
