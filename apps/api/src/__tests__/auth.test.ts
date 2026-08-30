import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { testAppDeps } from './fixtures.js';

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

describe('GET /auth/me', () => {
  it('returns 401 when unauthenticated', async () => {
    const app = buildApp(testAppDeps());

    const response = await app.inject({ method: 'GET', url: '/auth/me' });

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /auth/github/login', () => {
  it('redirects to GitHub with a state parameter and sets a state cookie', async () => {
    const app = buildApp(testAppDeps({ githubClientId: 'abc123' }));

    const response = await app.inject({ method: 'GET', url: '/auth/github/login' });

    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location as string);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('abc123');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(extractCookie(response.headers['set-cookie'], 'gh_oauth_state')).toBeTruthy();
  });

  // Regression coverage: the route must actually thread `cookiePolicy`
  // through to the state cookie, not just cookies.ts getting it right in
  // isolation -- the real bug was Secure being hardcoded, invisible to a
  // unit test of setCookie() alone if the route never varied its input.
  it('does not mark the state cookie Secure under a development-like cookie policy', async () => {
    const app = buildApp(testAppDeps({ cookiePolicy: { domain: undefined, secure: false } }));

    const response = await app.inject({ method: 'GET', url: '/auth/github/login' });

    const cookies = response.headers['set-cookie'] as string[];
    const stateCookie = cookies.find((h) => h.startsWith('gh_oauth_state='));
    expect(stateCookie).not.toContain('Secure');
  });

  it('marks the state cookie Secure under a production-like cookie policy', async () => {
    const app = buildApp(testAppDeps({ cookiePolicy: { domain: undefined, secure: true } }));

    const response = await app.inject({ method: 'GET', url: '/auth/github/login' });

    const cookies = response.headers['set-cookie'] as string[];
    const stateCookie = cookies.find((h) => h.startsWith('gh_oauth_state='));
    expect(stateCookie).toContain('Secure');
  });
});

describe('GET /auth/github/callback', () => {
  it('fails safely when GitHub reports the user denied access', async () => {
    const app = buildApp(testAppDeps());

    const response = await app.inject({
      method: 'GET',
      url: '/auth/github/callback?error=access_denied',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('error=oauth_denied');
  });

  it('fails safely when state is missing', async () => {
    const app = buildApp(testAppDeps());

    const response = await app.inject({
      method: 'GET',
      url: '/auth/github/callback?code=somecode&state=whatever',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('error=oauth_failed');
  });

  it('fails safely when state does not match the issued cookie', async () => {
    const app = buildApp(testAppDeps());

    const login = await app.inject({ method: 'GET', url: '/auth/github/login' });
    const stateCookie = extractCookie(login.headers['set-cookie'], 'gh_oauth_state');

    const response = await app.inject({
      method: 'GET',
      url: '/auth/github/callback?code=somecode&state=not-the-real-state',
      headers: { cookie: `gh_oauth_state=${stateCookie}` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('error=oauth_failed');
  });

  // The success path (upserting a user and creating a session) requires a
  // real database write and is covered by auth.integration.test.ts instead.

  it('clears the state cookie on first use (single-use, not just time-boxed)', async () => {
    // State-cookie clearing happens before the exchange/persist steps, so
    // this holds regardless of what happens later in the flow.
    const app = buildApp(testAppDeps());

    const login = await app.inject({ method: 'GET', url: '/auth/github/login' });
    const stateCookie = extractCookie(login.headers['set-cookie'], 'gh_oauth_state');
    const location = new URL(login.headers.location as string);
    const state = location.searchParams.get('state');

    const response = await app.inject({
      method: 'GET',
      url: `/auth/github/callback?code=somecode&state=${state}`,
      headers: { cookie: `gh_oauth_state=${stateCookie}` },
    });

    // A real browser honors this and stops sending gh_oauth_state, so a
    // reopened old callback link no longer carries a matching cookie.
    // (A raw HTTP client that deliberately resends the exact same cookie
    // bypasses this -- see docs/security.md for the documented limitation.)
    const clearedCookie = (response.headers['set-cookie'] as string[]).find((h) =>
      h.startsWith('gh_oauth_state='),
    );
    expect(clearedCookie).toContain('Max-Age=0');
  });
});
