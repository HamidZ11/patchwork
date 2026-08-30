import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadEnv } from '@patchwork/config';
import { createDbClient, schema, type DbClient } from '@patchwork/db';
import { buildApp } from '../app.js';
import { fakeGitHubClient, testAppDeps } from './fixtures.js';

function extractCookie(setCookieHeader: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  const match = headers.find((h) => h.startsWith(`${name}=`));
  if (!match) throw new Error(`cookie ${name} not set`);
  return match.split(';')[0]!.slice(name.length + 1);
}

let idCounter = 0;
function uniqueGithubUserId(): number {
  idCounter += 1;
  return Date.now() * 1000 + idCounter;
}

// Requires a reachable, migrated PostgreSQL instance (see docs/testing.md).
describe('GET /auth/github/callback (real database)', () => {
  const env = loadEnv();
  const db: DbClient = createDbClient(env.DATABASE_URL);

  afterAll(async () => {
    await db.close();
  });

  it('upserts a user, creates a session, and redirects to /repositories', async () => {
    const githubUserId = uniqueGithubUserId();
    const githubClient = fakeGitHubClient({
      exchangeOAuthCode: async () => 'fake-user-token',
      getAuthenticatedUser: async () => ({ id: githubUserId, login: 'octocat', avatarUrl: null }),
    });
    const app = buildApp(testAppDeps({ db, githubClient, webAppUrl: 'http://localhost:3000' }));

    const login = await app.inject({ method: 'GET', url: '/auth/github/login' });
    const stateCookie = extractCookie(login.headers['set-cookie'], 'gh_oauth_state');
    const state = new URL(login.headers.location as string).searchParams.get('state');

    const response = await app.inject({
      method: 'GET',
      url: `/auth/github/callback?code=somecode&state=${state}`,
      headers: { cookie: `gh_oauth_state=${stateCookie}` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('http://localhost:3000/repositories');
    const sessionToken = extractCookie(response.headers['set-cookie'], 'patchwork_session');
    expect(sessionToken).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: `patchwork_session=${sessionToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { githubLogin: 'octocat' } });

    await db.db.delete(schema.users).where(eq(schema.users.githubUserId, githubUserId));
  });

  it('upserting the same GitHub user twice results in one user row (idempotent login)', async () => {
    const githubUserId = uniqueGithubUserId();
    const githubClient = fakeGitHubClient({
      exchangeOAuthCode: async () => 'fake-user-token',
      getAuthenticatedUser: async () => ({ id: githubUserId, login: 'octocat', avatarUrl: null }),
    });
    const app = buildApp(testAppDeps({ db, githubClient }));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const login = await app.inject({ method: 'GET', url: '/auth/github/login' });
      const stateCookie = extractCookie(login.headers['set-cookie'], 'gh_oauth_state');
      const state = new URL(login.headers.location as string).searchParams.get('state');

      const response = await app.inject({
        method: 'GET',
        url: `/auth/github/callback?code=somecode&state=${state}`,
        headers: { cookie: `gh_oauth_state=${stateCookie}` },
      });
      expect(response.statusCode).toBe(302);
    }

    const rows = await db.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.githubUserId, githubUserId));
    expect(rows).toHaveLength(1);

    await db.db.delete(schema.users).where(eq(schema.users.githubUserId, githubUserId));
  });

  // Regression coverage for the real-world bug: the session cookie set on a
  // successful callback must also respect cookiePolicy.secure, not just the
  // OAuth state cookie -- both go through setCookie(), but only threading
  // both call sites through the route's deps proves neither was missed.
  it('sets the session cookie without Secure under a development-like cookie policy', async () => {
    const githubUserId = uniqueGithubUserId();
    const githubClient = fakeGitHubClient({
      exchangeOAuthCode: async () => 'fake-user-token',
      getAuthenticatedUser: async () => ({ id: githubUserId, login: 'octocat', avatarUrl: null }),
    });
    const app = buildApp(
      testAppDeps({ db, githubClient, cookiePolicy: { domain: undefined, secure: false } }),
    );

    const login = await app.inject({ method: 'GET', url: '/auth/github/login' });
    const stateCookie = extractCookie(login.headers['set-cookie'], 'gh_oauth_state');
    const state = new URL(login.headers.location as string).searchParams.get('state');

    const response = await app.inject({
      method: 'GET',
      url: `/auth/github/callback?code=somecode&state=${state}`,
      headers: { cookie: `gh_oauth_state=${stateCookie}` },
    });

    const cookies = response.headers['set-cookie'] as string[];
    const sessionCookie = cookies.find((h) => h.startsWith('patchwork_session='));
    expect(sessionCookie).not.toContain('Secure');
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Max-Age=2592000'); // 30 days

    await db.db.delete(schema.users).where(eq(schema.users.githubUserId, githubUserId));
  });

  it('sets the session cookie with Secure under a production-like cookie policy', async () => {
    const githubUserId = uniqueGithubUserId();
    const githubClient = fakeGitHubClient({
      exchangeOAuthCode: async () => 'fake-user-token',
      getAuthenticatedUser: async () => ({ id: githubUserId, login: 'octocat', avatarUrl: null }),
    });
    const app = buildApp(
      testAppDeps({ db, githubClient, cookiePolicy: { domain: undefined, secure: true } }),
    );

    const login = await app.inject({ method: 'GET', url: '/auth/github/login' });
    const stateCookie = extractCookie(login.headers['set-cookie'], 'gh_oauth_state');
    const state = new URL(login.headers.location as string).searchParams.get('state');

    const response = await app.inject({
      method: 'GET',
      url: `/auth/github/callback?code=somecode&state=${state}`,
      headers: { cookie: `gh_oauth_state=${stateCookie}` },
    });

    const cookies = response.headers['set-cookie'] as string[];
    const sessionCookie = cookies.find((h) => h.startsWith('patchwork_session='));
    expect(sessionCookie).toContain('Secure');

    await db.db.delete(schema.users).where(eq(schema.users.githubUserId, githubUserId));
  });
});
