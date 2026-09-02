import { writeFile } from 'node:fs/promises';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { buildFixtureArchive } from './build-fixture-archive.js';

/**
 * Test-only fakes, duplicated from apps/api/src/__tests__/fixtures.ts's
 * fakeGitHubClient/fakeGitHubAppAuth rather than shared across the app
 * boundary -- see build-fixture-archive.ts's doc comment for why that's
 * fine for test-only code even though production GitHub auth/archive
 * logic was moved to @patchwork/github specifically to avoid duplicating
 * it. Shared within apps/worker by both verification/__tests__ and
 * pull-requests/__tests__ -- moved here (from verification/__tests__)
 * once a second module needed it, matching CLAUDE.md's "don't abstract
 * before there's a second real use" guidance.
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
    getCommitTreeSha: async () => {
      throw new Error('getCommitTreeSha not stubbed for this test');
    },
    createBlob: async () => {
      throw new Error('createBlob not stubbed for this test');
    },
    createTree: async () => {
      throw new Error('createTree not stubbed for this test');
    },
    createCommit: async () => {
      throw new Error('createCommit not stubbed for this test');
    },
    getBranchRefSha: async () => {
      throw new Error('getBranchRefSha not stubbed for this test');
    },
    createBranchRef: async () => {
      throw new Error('createBranchRef not stubbed for this test');
    },
    createPullRequest: async () => {
      throw new Error('createPullRequest not stubbed for this test');
    },
    getPullRequest: async () => {
      throw new Error('getPullRequest not stubbed for this test');
    },
    listOpenPullRequestsForHead: async () => {
      throw new Error('listOpenPullRequestsForHead not stubbed for this test');
    },
    getBotUserId: async () => {
      throw new Error('getBotUserId not stubbed for this test');
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
