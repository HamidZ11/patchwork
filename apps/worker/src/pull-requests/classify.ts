import { GitHubApiError } from '@patchwork/github';
import type { PullRequestFailureCategory } from './types.js';

export type GitHubErrorContext = 'branch_ref' | 'pull_request' | 'other';

/**
 * Maps a raised error to one of the taxonomy's categories -- never a
 * generic "GitHub write failed," and never a raw exception message
 * surfaced to the user (GitHubApiError.details is GitHub's own short
 * `message` field, safe to show; anything else is reduced to a bounded,
 * Patchwork-authored sentence).
 *
 * 403 is ambiguous on GitHub's own API (used for both permission denial
 * and secondary rate limiting) -- distinguished here by the presence of a
 * parsed Retry-After header, which only accompanies rate-limit responses.
 * 422 on a branch-ref or PR-creation call is classified as a ruleset
 * rejection, not a generic validation error: Patchwork's own requests are
 * always well-formed (server-generated, deterministic), so in practice a
 * 422 on these specific calls can only mean a repository rule rejected
 * the request.
 */
export function classifyGitHubError(
  error: unknown,
  context: GitHubErrorContext,
): { category: PullRequestFailureCategory; reason: string } {
  if (error instanceof GitHubApiError) {
    if (error.status === 429 || (error.status === 403 && error.retryAfterSeconds !== undefined)) {
      const retrySuffix =
        error.retryAfterSeconds !== undefined ? ` Retry after ${error.retryAfterSeconds}s.` : '';
      return {
        category: 'RATE_LIMITED',
        reason: `GitHub rate-limited this request.${retrySuffix}`,
      };
    }
    if (error.status === 409 && context === 'branch_ref') {
      return {
        category: 'BRANCH_COLLISION',
        reason:
          'a branch with this name already exists and does not point at a commit Patchwork created.',
      };
    }
    if (error.status === 422 && (context === 'branch_ref' || context === 'pull_request')) {
      return {
        category: 'GITHUB_RULESET_FAILURE',
        reason: error.details
          ? `Repository rules prevented this action: ${error.details}`
          : 'Repository rules prevented Patchwork from creating this branch or pull request.',
      };
    }
    if (error.status === 403 || error.status === 404) {
      return {
        category: 'GITHUB_PERMISSION_FAILURE',
        reason:
          'Patchwork needs updated GitHub App permissions for this repository, or the installation no longer grants access.',
      };
    }
    return {
      category: 'GITHUB_API_FAILURE',
      reason: error.details
        ? `GitHub API error: ${error.details}`
        : `GitHub API error (status ${error.status}).`,
    };
  }
  return {
    category: 'GITHUB_API_FAILURE',
    reason: 'an unexpected error occurred while writing to GitHub.',
  };
}
