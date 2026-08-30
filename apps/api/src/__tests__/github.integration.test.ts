import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadEnv } from '@patchwork/config';
import { createDbClient, schema, type DbClient } from '@patchwork/db';
import { buildApp } from '../app.js';
import { createSession } from '../auth/sessions.js';
import { findOrCreateUserByGitHubProfile } from '../auth/users.js';
import type { GitHubInstallationInfo, GitHubRepository } from '../github/client.js';
import { fakeGitHubAppAuth, fakeGitHubClient, testAppDeps } from './fixtures.js';

let idCounter = 0;
function uniqueGithubId(): number {
  idCounter += 1;
  return Date.now() * 1000 + idCounter;
}

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

// Requires a reachable, migrated PostgreSQL instance (see docs/testing.md).
// Each test uses unique GitHub ids and cleans up exactly the rows it created.
describe('github install flow (real database)', () => {
  const env = loadEnv();
  const db: DbClient = createDbClient(env.DATABASE_URL);

  afterAll(async () => {
    await db.close();
  });

  async function createAuthenticatedSessionCookie(): Promise<{ cookie: string; userId: string }> {
    const user = await findOrCreateUserByGitHubProfile(db.db, {
      id: uniqueGithubId(),
      login: `test-user-${idCounter}`,
      avatarUrl: null,
    });
    const { token } = await createSession(db.db, user.id);
    return { cookie: `patchwork_session=${token}`, userId: user.id };
  }

  // Installations reference the connecting user with ON DELETE RESTRICT (see
  // packages/db/src/schema.ts), so installations/repositories (cascaded) must
  // be deleted before the user; deleting the user also cascades its sessions.
  async function cleanupUser(userId: string): Promise<void> {
    await db.db
      .delete(schema.githubInstallations)
      .where(eq(schema.githubInstallations.connectedByUserId, userId));
    await db.db.delete(schema.users).where(eq(schema.users.id, userId));
  }

  it('returns 401 for /github/install without a session', async () => {
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({ method: 'GET', url: '/github/install' });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 for /github/install/callback without a session', async () => {
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({ method: 'GET', url: '/github/install/callback' });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 for /repositories without a session', async () => {
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({ method: 'GET', url: '/repositories' });
    expect(response.statusCode).toBe(401);
  });

  it('returns an empty list for an authenticated user with no connected repositories', async () => {
    const app = buildApp(testAppDeps({ db }));
    const { cookie, userId } = await createAuthenticatedSessionCookie();

    const response = await app.inject({ method: 'GET', url: '/repositories', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ repositories: [] });

    await cleanupUser(userId);
  });

  it('redirects to the GitHub install URL with a state parameter', async () => {
    const app = buildApp(testAppDeps({ db, githubAppSlug: 'my-test-app' }));
    const { cookie, userId } = await createAuthenticatedSessionCookie();

    const response = await app.inject({
      method: 'GET',
      url: '/github/install',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location as string);
    expect(location.origin + location.pathname).toBe(
      'https://github.com/apps/my-test-app/installations/new',
    );
    expect(location.searchParams.get('state')).toBeTruthy();

    await cleanupUser(userId);
  });

  // Regression coverage: the install flow's state cookie is a separate
  // setCookie() call site from the login flow's -- both must thread
  // cookiePolicy through, not just one of them.
  it('does not mark the install state cookie Secure under a development-like cookie policy', async () => {
    const app = buildApp(testAppDeps({ db, cookiePolicy: { domain: undefined, secure: false } }));
    const { cookie, userId } = await createAuthenticatedSessionCookie();

    const response = await app.inject({
      method: 'GET',
      url: '/github/install',
      headers: { cookie },
    });

    const cookies = response.headers['set-cookie'] as string[];
    const stateCookie = cookies.find((h) => h.startsWith('gh_install_state='));
    expect(stateCookie).not.toContain('Secure');

    await cleanupUser(userId);
  });

  it('marks the install state cookie Secure under a production-like cookie policy', async () => {
    const app = buildApp(testAppDeps({ db, cookiePolicy: { domain: undefined, secure: true } }));
    const { cookie, userId } = await createAuthenticatedSessionCookie();

    const response = await app.inject({
      method: 'GET',
      url: '/github/install',
      headers: { cookie },
    });

    const cookies = response.headers['set-cookie'] as string[];
    const stateCookie = cookies.find((h) => h.startsWith('gh_install_state='));
    expect(stateCookie).toContain('Secure');

    await cleanupUser(userId);
  });

  it('redirects with install_pending_approval and writes nothing for setup_action=request', async () => {
    const app = buildApp(testAppDeps({ db }));
    const { cookie, userId } = await createAuthenticatedSessionCookie();

    const response = await app.inject({
      method: 'GET',
      url: '/github/install/callback?setup_action=request',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('error=install_pending_approval');

    await cleanupUser(userId);
  });

  it('fails closed with no writes when state is invalid', async () => {
    const app = buildApp(testAppDeps({ db }));
    const { cookie, userId } = await createAuthenticatedSessionCookie();

    const response = await app.inject({
      method: 'GET',
      url: `/github/install/callback?installation_id=${uniqueGithubId()}&setup_action=install&state=bogus`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('error=install_state_invalid');

    await cleanupUser(userId);
  });

  it('fails closed with no writes when GitHub validation of the installation fails', async () => {
    const githubClient = fakeGitHubClient({
      getInstallation: async () => {
        throw new Error('installation not found');
      },
    });
    const app = buildApp(testAppDeps({ db, githubClient }));
    const { cookie, userId } = await createAuthenticatedSessionCookie();

    const installResponse = await app.inject({
      method: 'GET',
      url: '/github/install',
      headers: { cookie },
    });
    const stateCookie = extractCookie(installResponse.headers['set-cookie'], 'gh_install_state');
    const state = new URL(installResponse.headers.location as string).searchParams.get('state');

    const installationId = uniqueGithubId();
    const response = await app.inject({
      method: 'GET',
      url: `/github/install/callback?installation_id=${installationId}&setup_action=install&state=${state}`,
      headers: { cookie: `${cookie}; gh_install_state=${stateCookie}` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('error=install_failed');

    const rows = await db.db
      .select()
      .from(schema.githubInstallations)
      .where(eq(schema.githubInstallations.githubInstallationId, installationId));
    expect(rows).toHaveLength(0);

    await cleanupUser(userId);
  });

  it('persists the installation and repositories on a valid callback, translated (not raw GitHub shape)', async () => {
    const installationId = uniqueGithubId();
    const repositoryId = uniqueGithubId();
    const installationInfo: GitHubInstallationInfo = {
      id: installationId,
      accountType: 'User',
      accountId: uniqueGithubId(),
      accountLogin: 'octocat',
    };
    const repository: GitHubRepository = {
      id: repositoryId,
      owner: 'octocat',
      name: 'hello-world',
      fullName: 'octocat/hello-world',
      isPrivate: false,
      defaultBranch: 'main',
    };
    const githubClient = fakeGitHubClient({
      getInstallation: async () => installationInfo,
      listInstallationRepositories: async () => [repository],
    });
    const app = buildApp(testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth() }));
    const { cookie, userId } = await createAuthenticatedSessionCookie();

    const installResponse = await app.inject({
      method: 'GET',
      url: '/github/install',
      headers: { cookie },
    });
    const stateCookie = extractCookie(installResponse.headers['set-cookie'], 'gh_install_state');
    const state = new URL(installResponse.headers.location as string).searchParams.get('state');

    const callback = await app.inject({
      method: 'GET',
      url: `/github/install/callback?installation_id=${installationId}&setup_action=install&state=${state}`,
      headers: { cookie: `${cookie}; gh_install_state=${stateCookie}` },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:3000/repositories');

    const list = await app.inject({ method: 'GET', url: '/repositories', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { repositories: unknown[] };
    expect(body.repositories).toHaveLength(1);
    expect(body.repositories[0]).toEqual({
      id: expect.any(String),
      owner: 'octocat',
      name: 'hello-world',
      fullName: 'octocat/hello-world',
      isPrivate: false,
      defaultBranch: 'main',
    });

    await cleanupUser(userId);
  });

  it('is idempotent: syncing the same installation and repository twice yields one row each', async () => {
    const installationId = uniqueGithubId();
    const repositoryId = uniqueGithubId();
    const installationInfo: GitHubInstallationInfo = {
      id: installationId,
      accountType: 'Organization',
      accountId: uniqueGithubId(),
      accountLogin: 'acme-corp',
    };
    const repository: GitHubRepository = {
      id: repositoryId,
      owner: 'acme-corp',
      name: 'widgets',
      fullName: 'acme-corp/widgets',
      isPrivate: true,
      defaultBranch: 'main',
    };
    const githubClient = fakeGitHubClient({
      getInstallation: async () => installationInfo,
      listInstallationRepositories: async () => [repository],
    });
    const app = buildApp(testAppDeps({ db, githubClient }));
    const { cookie, userId } = await createAuthenticatedSessionCookie();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const installResponse = await app.inject({
        method: 'GET',
        url: '/github/install',
        headers: { cookie },
      });
      const stateCookie = extractCookie(installResponse.headers['set-cookie'], 'gh_install_state');
      const state = new URL(installResponse.headers.location as string).searchParams.get('state');

      const callback = await app.inject({
        method: 'GET',
        url: `/github/install/callback?installation_id=${installationId}&setup_action=install&state=${state}`,
        headers: { cookie: `${cookie}; gh_install_state=${stateCookie}` },
      });
      expect(callback.statusCode).toBe(302);
    }

    const installations = await db.db
      .select()
      .from(schema.githubInstallations)
      .where(eq(schema.githubInstallations.githubInstallationId, installationId));
    expect(installations).toHaveLength(1);

    const repositories = await db.db
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.githubRepositoryId, repositoryId));
    expect(repositories).toHaveLength(1);

    await cleanupUser(userId);
  });
});
