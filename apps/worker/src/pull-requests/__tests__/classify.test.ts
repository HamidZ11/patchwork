import { GitHubApiError } from '@patchwork/github';
import { describe, expect, it } from 'vitest';
import { classifyGitHubError } from '../classify.js';

describe('classifyGitHubError', () => {
  it('classifies 409 on a branch-ref call as BRANCH_COLLISION', () => {
    const result = classifyGitHubError(
      new GitHubApiError('create_branch_ref_failed', 409, 'Reference already exists'),
      'branch_ref',
    );
    expect(result.category).toBe('BRANCH_COLLISION');
  });

  it('classifies 422 on a branch-ref call as GITHUB_RULESET_FAILURE, not a generic failure', () => {
    const result = classifyGitHubError(
      new GitHubApiError(
        'create_branch_ref_failed',
        422,
        'Changes must be made through a pull request',
      ),
      'branch_ref',
    );
    expect(result.category).toBe('GITHUB_RULESET_FAILURE');
    expect(result.reason).toContain('Changes must be made through a pull request');
  });

  it('classifies 422 on a pull-request call as GITHUB_RULESET_FAILURE', () => {
    const result = classifyGitHubError(
      new GitHubApiError('create_pull_request_failed', 422, 'rule violation'),
      'pull_request',
    );
    expect(result.category).toBe('GITHUB_RULESET_FAILURE');
  });

  it('classifies 403 with a Retry-After as RATE_LIMITED, not a permission failure', () => {
    const result = classifyGitHubError(
      new GitHubApiError('create_blob_failed', 403, 'secondary rate limit', 30),
      'other',
    );
    expect(result.category).toBe('RATE_LIMITED');
    expect(result.reason).toContain('30');
  });

  it('classifies 429 as RATE_LIMITED even without a Retry-After header', () => {
    const result = classifyGitHubError(new GitHubApiError('create_blob_failed', 429), 'other');
    expect(result.category).toBe('RATE_LIMITED');
  });

  it('classifies a plain 403 (no Retry-After) as GITHUB_PERMISSION_FAILURE', () => {
    const result = classifyGitHubError(
      new GitHubApiError('create_blob_failed', 403, 'Resource not accessible by integration'),
      'other',
    );
    expect(result.category).toBe('GITHUB_PERMISSION_FAILURE');
    expect(result.reason).toContain('GitHub App permissions');
  });

  it('classifies 404 as GITHUB_PERMISSION_FAILURE (installation no longer grants access)', () => {
    const result = classifyGitHubError(new GitHubApiError('create_blob_failed', 404), 'other');
    expect(result.category).toBe('GITHUB_PERMISSION_FAILURE');
  });

  it('classifies an unrecognized status as GITHUB_API_FAILURE, never exposing a raw stack', () => {
    const result = classifyGitHubError(
      new GitHubApiError('create_blob_failed', 500, 'internal server error'),
      'other',
    );
    expect(result.category).toBe('GITHUB_API_FAILURE');
    expect(result.reason).not.toContain('at ');
  });

  it('classifies a non-GitHubApiError as GITHUB_API_FAILURE without leaking its message', () => {
    const result = classifyGitHubError(new Error('ECONNRESET some internal detail'), 'other');
    expect(result.category).toBe('GITHUB_API_FAILURE');
    expect(result.reason).not.toContain('ECONNRESET');
  });
});
