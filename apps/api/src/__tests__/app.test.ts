import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { fakeDbClient, testAppDeps } from './fixtures.js';

describe('GET /health', () => {
  it('returns 200 and a status payload', async () => {
    const app = buildApp(testAppDeps());

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /ready', () => {
  it('returns 200 when the database is reachable', async () => {
    const app = buildApp(testAppDeps());

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 when the database is unreachable', async () => {
    const db = fakeDbClient({
      ping: async () => {
        throw new Error('connection refused');
      },
    });
    const app = buildApp(testAppDeps({ db }));

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'unavailable' });
  });
});

describe('unknown routes', () => {
  it('returns a structured 404', async () => {
    const app = buildApp(testAppDeps());

    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'Not Found' });
  });
});
