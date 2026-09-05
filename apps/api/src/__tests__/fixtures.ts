import { writeFile } from 'node:fs/promises';
import type { Database, DbClient } from '@patchwork/db';
import type { AppDeps } from '../app.js';
import type { ExplanationModel } from '../explanations/types.js';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { buildFixtureArchive } from './build-fixture-archive.js';

/**
 * A large random integer, safe to use as a synthetic GitHub id
 * (github_user_id / github_installation_id / github_repository_id) in
 * integration tests. Vitest runs test files concurrently by default, and
 * every integration test file shares one real PostgreSQL instance -- a
 * per-file counter combined with `Date.now()` can collide across files
 * that happen to generate an id in the same millisecond, silently
 * merging two unrelated tests' rows via `onConflictDoUpdate` and causing
 * one test's cleanup to delete another concurrently-running test's
 * in-progress data. A random draw from a huge range makes cross-process
 * collisions negligible without needing any shared coordination between
 * files.
 */
export function uniqueGithubId(): number {
  return Math.floor(Math.random() * 1_000_000_000_000);
}

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

/**
 * A deterministic stand-in for the OpenAI-backed ExplanationModel. Every
 * automated test drives this, never the network: an explanation test asserts
 * caching, authorization and truth-boundary behaviour, none of which needs a
 * real generation, and a suite that spent credits per run would be a suite
 * nobody runs. `calls` lets a test prove a cache hit made no second request.
 */
export function fakeExplanationModel(
  overrides: Partial<ExplanationModel> & { calls?: { count: number } } = {},
): ExplanationModel & { calls: { count: number } } {
  const calls = overrides.calls ?? { count: 0 };
  return {
    calls,
    model: overrides.model ?? 'test-explanation-model',
    generate:
      overrides.generate ??
      (async (context) => {
        calls.count += 1;
        return {
          explanation: {
            summary: `Summary for ${context.verdict}.`,
            whyItMatters: `Why it matters for ${context.verdict}.`,
            nextStep: 'Next step.',
          },
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }),
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
    explanationModel: fakeExplanationModel(),
    ...overrides,
  };
}
