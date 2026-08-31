import type { GitHubClient } from '../github/client.js';
import type { GitHubAppAuth } from '../github/auth.js';

export interface ResolvedSnapshot {
  commitSha: string;
  ref: string;
  acquisitionMethod: string;
}

/**
 * Resolves the exact current commit SHA for a repository's default branch.
 * Orchestration only -- no DB access, no HTTP request/response shaping.
 * Uses the repository's already-stored default_branch (from the connect
 * flow) rather than re-fetching repo metadata first: one GitHub API call,
 * not two. If the default branch was renamed on GitHub since connection,
 * this throws (a clean GitHub-boundary failure) rather than silently
 * resolving the wrong branch -- accepted limitation for this slice.
 */
export async function resolveRepositorySnapshot(
  params: { owner: string; name: string; defaultBranch: string; githubInstallationId: number },
  deps: { client: GitHubClient; appAuth: GitHubAppAuth },
): Promise<ResolvedSnapshot> {
  const installationToken = await deps.appAuth.getInstallationToken(params.githubInstallationId);
  const commitSha = await deps.client.getBranchCommitSha(
    params.owner,
    params.name,
    params.defaultBranch,
    installationToken,
  );

  return {
    commitSha,
    ref: params.defaultBranch,
    acquisitionMethod: 'github_default_branch',
  };
}
