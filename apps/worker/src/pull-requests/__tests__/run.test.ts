import { createHash } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { describe, expect, it } from 'vitest';
import { fakeGitHubAppAuth } from '../../__tests__/fixtures.js';
import { publishPullRequest, type PublishDeps } from '../run.js';
import type { PublishContext } from '../types.js';
import { createFakeGitHubRepo } from './fake-github-repo.js';

const BEFORE = 'export function f(invoice: any) {\n  return invoice.subscription;\n}\n';
const AFTER =
  'export function f(invoice: any) {\n  return (invoice.parent?.subscription_details?.subscription ?? null);\n}\n';
const DIFF = createTwoFilesPatch(
  'src/billing.ts',
  'src/billing.ts',
  BEFORE,
  AFTER,
  undefined,
  undefined,
  {
    context: 3,
  },
);
const DIFF_SHA256 = createHash('sha256').update(DIFF).digest('hex');
const ANALYSED_SHA = 'a'.repeat(40);

function fixtureContext(overrides: Partial<PublishContext> = {}): PublishContext {
  return {
    patchAttemptId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    impactAssessmentId: 'assess-1',
    patchAttemptStatus: 'GENERATED',
    diff: DIFF,
    changedFiles: ['src/billing.ts'],
    transformationKind: 'stripe_invoice_subscription_to_parent',
    postconditionChecks: [{ name: 'replacement pattern present', passed: true }],
    verificationRunId: 'run-1',
    verificationRunStatus: 'PASSED',
    verificationDiffSha256: DIFF_SHA256,
    verificationSteps: [
      { kind: 'install', status: 'PASSED', exitCode: 0 },
      { kind: 'typecheck', status: 'PASSED', exitCode: 0 },
      { kind: 'test', status: 'PASSED', exitCode: 0 },
    ],
    nodeVersion: '20',
    nodeVersionSource: 'patchwork_default',
    packageManager: 'npm',
    sandboxRuntime: 'patchwork-verification-node20',
    repositoryOwner: 'octocat',
    repositoryName: 'hello-world',
    repositoryFullName: 'octocat/hello-world',
    githubInstallationId: 123,
    defaultBranch: 'main',
    analysedCommitSha: ANALYSED_SHA,
    providerChangeTitle: 'Removes Invoice.subscription',
    providerChangeSourceUrl: 'https://docs.stripe.com/changelog/example',
    providerChangeExternalId: 'basil-example',
    migrationRequirement: 'Use invoice.parent.subscription_details.subscription instead.',
    ...overrides,
  };
}

function baseRepo(overrides: Parameters<typeof createFakeGitHubRepo>[1] = {}) {
  return createFakeGitHubRepo(
    { defaultBranch: 'main', defaultBranchSha: ANALYSED_SHA, files: { 'src/billing.ts': BEFORE } },
    overrides,
  );
}

function deps(
  repo: ReturnType<typeof createFakeGitHubRepo>,
  priorCommitShas: string[] = [],
  assessmentOpenedPullRequest: PublishDeps['assessmentOpenedPullRequest'] = null,
): PublishDeps {
  return {
    githubClient: repo.client,
    githubAppAuth: fakeGitHubAppAuth(),
    appSlug: 'patchwork-dev',
    priorCommitShas,
    assessmentOpenedPullRequest,
  };
}

describe('publishPullRequest', () => {
  it('happy path: creates a branch, one commit, and opens a PR', async () => {
    const repo = baseRepo();
    const outcome = await publishPullRequest(fixtureContext(), deps(repo));

    expect(outcome.status).toBe('OPENED');
    expect(outcome.branchName).toBe('patchwork/stripe-invoice-subscription-to-parent/a1b2c3d4');
    expect(outcome.commitSha).toBeTruthy();
    expect(outcome.githubPrNumber).toBe(1);
    expect(repo.refs.get(outcome.branchName!)).toBe(outcome.commitSha);
    expect(repo.prs[0]?.headBranch).toBe(outcome.branchName);
  });

  it('refuses with STALE_BASE when the default branch has moved since analysis', async () => {
    const repo = baseRepo();
    repo.advanceDefaultBranch('b'.repeat(40));

    const outcome = await publishPullRequest(fixtureContext(), deps(repo));

    expect(outcome.status).toBe('REFUSED');
    expect(outcome.failureCategory).toBe('STALE_BASE');
    expect(repo.prs).toHaveLength(0);
  });

  it('refuses with POLICY_REFUSAL when the verification run is not PASSED', async () => {
    const repo = baseRepo();
    const outcome = await publishPullRequest(
      fixtureContext({ verificationRunStatus: 'FAILED' }),
      deps(repo),
    );

    expect(outcome.status).toBe('REFUSED');
    expect(outcome.failureCategory).toBe('POLICY_REFUSAL');
  });

  it('refuses with POLICY_REFUSAL when the verified diff hash does not match', async () => {
    const repo = baseRepo();
    const outcome = await publishPullRequest(
      fixtureContext({ verificationDiffSha256: 'mismatched-hash' }),
      deps(repo),
    );

    expect(outcome.status).toBe('REFUSED');
    expect(outcome.failureCategory).toBe('POLICY_REFUSAL');
  });

  it('refuses with POLICY_REFUSAL for a forbidden changed file', async () => {
    const repo = baseRepo();
    const outcome = await publishPullRequest(
      fixtureContext({ changedFiles: ['package.json'] }),
      deps(repo),
    );

    expect(outcome.status).toBe('REFUSED');
    expect(outcome.failureCategory).toBe('POLICY_REFUSAL');
  });

  it('fails with BRANCH_COLLISION when a same-named branch exists pointing at an unrecognized commit', async () => {
    const repo = baseRepo();
    repo.seedBranch('patchwork/stripe-invoice-subscription-to-parent/a1b2c3d4', 'c'.repeat(40));

    const outcome = await publishPullRequest(fixtureContext(), deps(repo));

    expect(outcome.status).toBe('FAILED');
    expect(outcome.failureCategory).toBe('BRANCH_COLLISION');
    expect(repo.prs).toHaveLength(0);
  });

  it('reuses a prior commit object instead of creating a duplicate when only the ref is missing', async () => {
    const repo = baseRepo();
    const priorSha = 'd'.repeat(40);
    repo.seedCommit(priorSha, repo.trees.keys().next().value as string, [ANALYSED_SHA]);
    const blobsBefore = repo.blobs.size;

    const outcome = await publishPullRequest(fixtureContext(), deps(repo, [priorSha]));

    expect(outcome.status).toBe('OPENED');
    expect(outcome.commitSha).toBe(priorSha);
    expect(repo.blobs.size).toBe(blobsBefore); // no new blob/commit built
    expect(repo.refs.get(outcome.branchName!)).toBe(priorSha);
  });

  it('reconciles an already-existing branch that matches the prior commit, and finds the already-open PR (idempotent full resume)', async () => {
    const repo = baseRepo();
    const first = await publishPullRequest(fixtureContext(), deps(repo));
    expect(first.status).toBe('OPENED');

    const second = await publishPullRequest(fixtureContext(), deps(repo, [first.commitSha!]));

    expect(second.status).toBe('OPENED');
    expect(second.commitSha).toBe(first.commitSha);
    expect(second.githubPrNumber).toBe(first.githubPrNumber);
    expect(repo.prs).toHaveLength(1); // never duplicated
  });

  it('classifies a permission failure on branch creation as GITHUB_PERMISSION_FAILURE', async () => {
    const repo = baseRepo({
      createBranchRef: async () => {
        const { GitHubApiError } = await import('@patchwork/github');
        throw new GitHubApiError(
          'create_branch_ref_failed',
          403,
          'Resource not accessible by integration',
        );
      },
    });

    const outcome = await publishPullRequest(fixtureContext(), deps(repo));

    expect(outcome.status).toBe('FAILED');
    expect(outcome.failureCategory).toBe('GITHUB_PERMISSION_FAILURE');
  });

  it('classifies a ruleset rejection on branch creation as GITHUB_RULESET_FAILURE', async () => {
    const repo = baseRepo({
      createBranchRef: async () => {
        const { GitHubApiError } = await import('@patchwork/github');
        throw new GitHubApiError(
          'create_branch_ref_failed',
          422,
          'Changes must be made through a pull request',
        );
      },
    });

    const outcome = await publishPullRequest(fixtureContext(), deps(repo));

    expect(outcome.status).toBe('FAILED');
    expect(outcome.failureCategory).toBe('GITHUB_RULESET_FAILURE');
  });

  it('classifies a rate-limited blob creation as RATE_LIMITED', async () => {
    const repo = baseRepo({
      createBlob: async () => {
        const { GitHubApiError } = await import('@patchwork/github');
        throw new GitHubApiError('create_blob_failed', 403, 'secondary rate limit exceeded', 30);
      },
    });

    const outcome = await publishPullRequest(fixtureContext(), deps(repo));

    expect(outcome.status).toBe('FAILED');
    expect(outcome.failureCategory).toBe('RATE_LIMITED');
  });

  it('records branch/commit even when PR creation itself fails, and a retry resumes without recreating them', async () => {
    let failPr = true;
    const repo = baseRepo({
      createPullRequest: async () => {
        if (failPr) {
          const { GitHubApiError } = await import('@patchwork/github');
          throw new GitHubApiError('create_pull_request_failed', 500, 'temporary error');
        }
        return {
          number: 42,
          url: 'https://github.com/octocat/hello-world/pull/42',
          state: 'open' as const,
          merged: false,
        };
      },
    });

    const first = await publishPullRequest(fixtureContext(), deps(repo));
    expect(first.status).toBe('FAILED');
    expect(first.failureCategory).toBe('GITHUB_API_FAILURE');
    expect(first.branchName).toBeTruthy();
    expect(first.commitSha).toBeTruthy();
    const blobsAfterFirst = repo.blobs.size;

    failPr = false;
    const second = await publishPullRequest(fixtureContext(), deps(repo, [first.commitSha!]));

    expect(second.status).toBe('OPENED');
    expect(second.commitSha).toBe(first.commitSha);
    expect(repo.blobs.size).toBe(blobsAfterFirst); // no duplicate commit built on resume
  });

  it('refuses to open a second pull request when the assessment already has one open', async () => {
    const repo = baseRepo();

    const outcome = await publishPullRequest(
      fixtureContext(),
      deps(repo, [], {
        githubPrNumber: 1,
        githubPrUrl: 'https://github.com/octocat/hello-world/pull/1',
      }),
    );

    expect(outcome.status).toBe('REFUSED');
    expect(outcome.failureCategory).toBe('POLICY_REFUSAL');
    expect(outcome.failureReason).toContain('#1');
    expect(outcome.failureReason).toContain('earlier patch attempt');

    // Nothing reached GitHub: no branch, no commit, no PR. The refusal happens
    // before any write, so a duplicate is never partially created.
    expect(repo.prs).toHaveLength(0);
    expect(repo.blobs.size).toBe(0);
    expect(repo.refs.size).toBe(1); // only the pre-existing default branch
  });

  it('publishes normally when the sibling lookup finds no open pull request', async () => {
    const repo = baseRepo();

    const outcome = await publishPullRequest(fixtureContext(), deps(repo, [], null));

    expect(outcome.status).toBe('OPENED');
    expect(repo.prs).toHaveLength(1);
  });
});
