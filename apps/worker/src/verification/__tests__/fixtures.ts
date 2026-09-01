import { writeFile } from 'node:fs/promises';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { buildFixtureArchive } from './build-fixture-archive.js';

/**
 * Test-only fakes, duplicated from apps/api/src/__tests__/fixtures.ts's
 * fakeGitHubClient/fakeGitHubAppAuth rather than shared across the app
 * boundary -- see build-fixture-archive.ts's doc comment for why that's
 * fine for test-only code even though production GitHub auth/archive
 * logic was moved to @patchwork/github specifically to avoid duplicating
 * it.
 */
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
