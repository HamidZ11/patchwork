import { writeFile } from 'node:fs/promises';
import type { Database, DbClient } from '@patchwork/db';
import type { AppDeps } from '../app.js';
import type { GitHubAppAuth } from '../github/auth.js';
import type { GitHubClient } from '../github/client.js';
import { buildFixtureArchive } from './build-fixture-archive.js';

export function fakeDbClient(overrides: Partial<DbClient> = {}): DbClient {
  return {
    db: {} as Database,
    ping: async () => {},
    close: async () => {},
    ...overrides,
  };
}

export function fakeGitHubClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    exchangeOAuthCode: async () => {
      throw new Error('exchangeOAuthCode not stubbed for this test');
    },
    getAuthenticatedUser: async () => {
      throw new Error('getAuthenticatedUser not stubbed for this test');
    },
    getInstallation: async () => {
      throw new Error('getInstallation not stubbed for this test');
    },
    listInstallationRepositories: async () => {
      throw new Error('listInstallationRepositories not stubbed for this test');
    },
    getBranchCommitSha: async () => {
      throw new Error('getBranchCommitSha not stubbed for this test');
    },
    downloadRepositoryArchive: async () => {
      throw new Error('downloadRepositoryArchive not stubbed for this test');
    },
    ...overrides,
  };
}

/**
 * A fakeGitHubClient whose downloadRepositoryArchive writes a real
 * .tar.gz built from `files` (see buildFixtureArchive) to whatever
 * destination path is requested -- exercises the real extraction/parsing
 * code in analysis/archive.ts and analysis/evidence/*, only the GitHub
 * HTTP boundary itself is faked.
 */
export function fakeGitHubClientWithArchive(
  files: Record<string, string>,
  overrides: Partial<GitHubClient> = {},
): GitHubClient {
  return fakeGitHubClient({
    downloadRepositoryArchive: async (_owner, _name, _commitSha, _token, destinationPath) => {
      const archive = await buildFixtureArchive(files);
      await writeFile(destinationPath, archive);
    },
    ...overrides,
  });
}

export function fakeGitHubAppAuth(overrides: Partial<GitHubAppAuth> = {}): GitHubAppAuth {
  return {
    getAppToken: async () => 'fake-app-token',
    getInstallationToken: async () => 'fake-installation-token',
    ...overrides,
  };
}

export function testAppDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    db: fakeDbClient(),
    logLevel: 'silent',
    githubClient: fakeGitHubClient(),
    githubAppAuth: fakeGitHubAppAuth(),
    githubClientId: 'test-client-id',
    githubClientSecret: 'test-client-secret',
    githubAppSlug: 'test-app',
    cookiePolicy: { domain: undefined, secure: false },
    webAppUrl: 'http://localhost:3000',
    ...overrides,
  };
}
