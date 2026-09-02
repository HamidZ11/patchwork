import { writeFile } from 'node:fs/promises';
import { GitHubApiError, type GitHubClient } from '@patchwork/github';
import { buildFixtureArchive } from '../../__tests__/build-fixture-archive.js';
import { fakeGitHubClient } from '../../__tests__/fixtures.js';

interface FakePr {
  number: number;
  headBranch: string;
  state: 'open' | 'closed';
  merged: boolean;
  url: string;
}

/**
 * A small, stateful in-memory GitHub repository -- just enough surface
 * (refs, commits, trees, blobs, PRs) to exercise the real branch/commit/
 * PR reconciliation logic in run.ts against realistic sequences (a
 * branch that already exists, a commit object that already exists but
 * isn't yet referenced, an existing open PR) without ever making a real
 * network call. `overrides` layers additional per-test failure injection
 * on top (e.g. making createBranchRef throw a specific error) using the
 * same fakeGitHubClient(overrides) convention as every other test file.
 */
export function createFakeGitHubRepo(
  options: {
    defaultBranch: string;
    defaultBranchSha: string;
    files: Record<string, string>;
  },
  overrides: Partial<GitHubClient> = {},
) {
  let shaCounter = 0;
  const nextSha = () => `${(shaCounter++).toString().padStart(4, '0')}${'0'.repeat(36)}`;

  const refs = new Map<string, string>();
  const commits = new Map<string, { treeSha: string; parents: string[] }>();
  const trees = new Map<string, { path: string; blobSha: string }[]>();
  const blobs = new Map<string, string>();
  const prs: FakePr[] = [];
  let nextPrNumber = 1;

  const baseTreeSha = nextSha();
  trees.set(baseTreeSha, []);
  commits.set(options.defaultBranchSha, { treeSha: baseTreeSha, parents: [] });
  refs.set(options.defaultBranch, options.defaultBranchSha);

  const client = fakeGitHubClient({
    downloadRepositoryArchive: async (_owner, _name, _commitSha, _token, destinationPath) => {
      const archive = await buildFixtureArchive(options.files);
      await writeFile(destinationPath, archive);
    },
    getBranchCommitSha: async (_owner, _name, branch) => {
      const sha = refs.get(branch);
      if (!sha) throw new GitHubApiError('get_branch_commit_sha_failed', 404);
      return sha;
    },
    getCommitTreeSha: async (_owner, _name, commitSha) => {
      const commit = commits.get(commitSha);
      if (!commit) throw new GitHubApiError('get_commit_tree_sha_failed', 404);
      return commit.treeSha;
    },
    createBlob: async (_owner, _name, contentBase64) => {
      const sha = nextSha();
      blobs.set(sha, contentBase64);
      return sha;
    },
    createTree: async (_owner, _name, _baseTreeSha, entries) => {
      const sha = nextSha();
      trees.set(
        sha,
        entries.map((entry) => ({ path: entry.path, blobSha: entry.blobSha })),
      );
      return sha;
    },
    createCommit: async (_owner, _name, params) => {
      const sha = nextSha();
      commits.set(sha, { treeSha: params.treeSha, parents: params.parentShas });
      return sha;
    },
    getBranchRefSha: async (_owner, _name, branch) => refs.get(branch) ?? null,
    createBranchRef: async (_owner, _name, branch, commitSha) => {
      if (refs.has(branch)) {
        throw new GitHubApiError('create_branch_ref_failed', 409, 'Reference already exists');
      }
      refs.set(branch, commitSha);
    },
    createPullRequest: async (_owner, _name, params) => {
      const number = nextPrNumber;
      nextPrNumber += 1;
      const url = `https://github.com/octocat/hello-world/pull/${number}`;
      prs.push({ number, headBranch: params.head, state: 'open', merged: false, url });
      return { number, url, state: 'open', merged: false };
    },
    getPullRequest: async (_owner, _name, number) => {
      const pr = prs.find((candidate) => candidate.number === number);
      if (!pr) throw new GitHubApiError('get_pull_request_failed', 404);
      return { number: pr.number, url: pr.url, state: pr.state, merged: pr.merged };
    },
    listOpenPullRequestsForHead: async (_owner, _name, branch) =>
      prs
        .filter((pr) => pr.headBranch === branch && pr.state === 'open')
        .map((pr) => ({ number: pr.number, url: pr.url, state: pr.state, merged: pr.merged })),
    getBotUserId: async () => 999999,
    ...overrides,
  });

  return {
    client,
    refs,
    commits,
    trees,
    blobs,
    prs,
    /** Simulates the repository's default branch advancing past the analysed SHA. */
    advanceDefaultBranch: (newSha: string) => {
      const treeSha = nextSha();
      trees.set(treeSha, []);
      commits.set(newSha, { treeSha, parents: [refs.get(options.defaultBranch) as string] });
      refs.set(options.defaultBranch, newSha);
    },
    /** Directly creates a branch (out of band, as if some other actor -- or a prior worker run -- created it). */
    seedBranch: (branch: string, commitSha: string) => {
      refs.set(branch, commitSha);
    },
    seedCommit: (commitSha: string, treeSha: string, parents: string[]) => {
      commits.set(commitSha, { treeSha, parents });
    },
  };
}
