import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withExtractedArchiveForVerification } from '@patchwork/archive';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { resolveBotIdentity } from './bot-identity.js';
import { classifyGitHubError } from './classify.js';
import { deriveBranchName, deriveCommitMessage, derivePrBody, derivePrTitle } from './policy.js';
import { reconstructFinalFileContents } from './reconstruct.js';
import type { PublishContext, PublishOutcome, PullRequestFailureCategory } from './types.js';

const FORBIDDEN_PATH_PATTERNS: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)\.github\//,
];

export interface PublishDeps {
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
  appSlug: string;
  /**
   * Every OTHER PullRequestAttempt for the same PatchAttempt that has a
   * persisted commit_sha, newest first -- fetched by the caller
   * (apps/worker/src/pull-requests/process.ts) before invoking this pure
   * orchestration function, so run.ts itself stays DB-free and testable
   * against only a fake GitHubClient, matching verification/run.ts's own
   * architecture (DB access lives in persistence.ts/process.ts, never in
   * the orchestration function itself).
   */
  priorCommitShas: string[];
}

function refused(category: PullRequestFailureCategory, reason: string): PublishOutcome {
  return {
    status: 'REFUSED',
    failureCategory: category,
    failureReason: reason,
    branchName: null,
    commitSha: null,
    githubPrNumber: null,
    githubPrUrl: null,
  };
}

function failed(
  category: PullRequestFailureCategory,
  reason: string,
  branchName: string | null = null,
  commitSha: string | null = null,
): PublishOutcome {
  return {
    status: 'FAILED',
    failureCategory: category,
    failureReason: reason,
    branchName,
    commitSha,
    githubPrNumber: null,
    githubPrUrl: null,
  };
}

function opened(
  branchName: string,
  commitSha: string,
  prNumber: number,
  prUrl: string,
): PublishOutcome {
  return {
    status: 'OPENED',
    failureCategory: null,
    failureReason: null,
    branchName,
    commitSha,
    githubPrNumber: prNumber,
    githubPrUrl: prUrl,
  };
}

/**
 * Re-verifies every eligibility rule server-side, from freshly-read
 * persisted state -- defense in depth alongside the API's own offline
 * checks at enqueue time, since this is the actual point a GitHub write
 * happens. Every one of these is a pure, already-persisted-data check;
 * none require a GitHub call (the one check that does -- current default
 * branch HEAD -- happens separately below as the stale-base check).
 */
function reVerifyEligibility(
  context: PublishContext,
): { kind: 'ok'; diff: string } | { kind: 'refused'; reason: string } {
  if (context.patchAttemptStatus !== 'GENERATED') {
    return {
      kind: 'refused',
      reason: `patch attempt status is ${context.patchAttemptStatus}, not GENERATED -- nothing to publish`,
    };
  }
  if (!context.diff || context.changedFiles.length === 0) {
    return { kind: 'refused', reason: 'patch attempt has no diff to publish' };
  }
  if (context.verificationRunStatus !== 'PASSED') {
    return {
      kind: 'refused',
      reason: `verification run status is ${context.verificationRunStatus}, not PASSED -- only a passed sandbox verification may authorize publication`,
    };
  }
  const actualDiffSha256 = createHash('sha256').update(context.diff).digest('hex');
  if (context.verificationDiffSha256 !== actualDiffSha256) {
    return {
      kind: 'refused',
      reason: 'the verified diff hash does not match the current patch attempt diff',
    };
  }
  for (const path of context.changedFiles) {
    if (FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
      return { kind: 'refused', reason: `${path} is a forbidden path for automatic publication` };
    }
  }
  return { kind: 'ok', diff: context.diff };
}

/**
 * Downloads the exact analysed snapshot, reconstructs each changed
 * file's final content from that snapshot plus the exact persisted diff
 * (never current mutable HEAD), and creates blobs/a tree/a commit object
 * -- not yet reachable from any ref. Nothing is visible on GitHub until
 * the caller successfully creates the branch ref pointing at the
 * returned commit SHA.
 */
async function buildNewCommit(
  context: PublishContext,
  diff: string,
  deps: PublishDeps,
  installationToken: string,
): Promise<{ kind: 'ok'; commitSha: string } | { kind: 'failed'; outcome: PublishOutcome }> {
  const downloadDir = await mkdtemp(join(tmpdir(), 'patchwork-pr-download-'));
  const archivePath = join(downloadDir, 'archive.tar.gz');

  let filesByPath: Map<string, string>;
  try {
    try {
      await deps.githubClient.downloadRepositoryArchive(
        context.repositoryOwner,
        context.repositoryName,
        context.analysedCommitSha,
        installationToken,
        archivePath,
      );
    } catch (error) {
      const { category, reason } = classifyGitHubError(error, 'other');
      return { kind: 'failed', outcome: failed(category, reason) };
    }

    const extraction = await withExtractedArchiveForVerification(archivePath, (result) => result);
    if (extraction.truncated) {
      return {
        kind: 'failed',
        outcome: failed(
          'GITHUB_API_FAILURE',
          'repository snapshot extraction was truncated -- refusing to publish against an incomplete snapshot',
        ),
      };
    }

    const originalContentByPath = new Map<string, string>();
    for (const file of extraction.files) {
      if (context.changedFiles.includes(file.path)) {
        originalContentByPath.set(
          file.path,
          Buffer.from(file.contentBase64, 'base64').toString('utf-8'),
        );
      }
    }

    const reconstructed = reconstructFinalFileContents(
      diff,
      context.changedFiles,
      originalContentByPath,
    );
    if (reconstructed.kind !== 'ok') {
      return { kind: 'failed', outcome: failed('PATCH_APPLICATION_FAILURE', reconstructed.reason) };
    }
    filesByPath = reconstructed.filesByPath;
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }

  try {
    const baseTreeSha = await deps.githubClient.getCommitTreeSha(
      context.repositoryOwner,
      context.repositoryName,
      context.analysedCommitSha,
      installationToken,
    );

    const entries: { path: string; blobSha: string }[] = [];
    for (const [path, content] of filesByPath) {
      const blobSha = await deps.githubClient.createBlob(
        context.repositoryOwner,
        context.repositoryName,
        Buffer.from(content, 'utf-8').toString('base64'),
        installationToken,
      );
      entries.push({ path, blobSha });
    }

    const treeSha = await deps.githubClient.createTree(
      context.repositoryOwner,
      context.repositoryName,
      baseTreeSha,
      entries,
      installationToken,
    );

    const author = await resolveBotIdentity(
      { githubClient: deps.githubClient, githubAppAuth: deps.githubAppAuth },
      deps.appSlug,
    );
    const commitSha = await deps.githubClient.createCommit(
      context.repositoryOwner,
      context.repositoryName,
      {
        message: deriveCommitMessage(context),
        treeSha,
        parentShas: [context.analysedCommitSha],
        author,
      },
      installationToken,
    );

    return { kind: 'ok', commitSha };
  } catch (error) {
    const { category, reason } = classifyGitHubError(error, 'other');
    return { kind: 'failed', outcome: failed(category, reason) };
  }
}

/**
 * Publishes one PASSED VerificationRun's already-verified PatchAttempt to
 * GitHub. Every step re-checks live GitHub state rather than trusting
 * this attempt's own (or a prior attempt's) persisted fields as proof an
 * earlier write happened -- a crash can occur after GitHub successfully
 * creates a ref/commit/PR but before that success is persisted, so
 * recovery always reconciles against GitHub itself. See docs/verification.md-
 * style reasoning in types.ts's doc comment for the full rationale.
 */
export async function publishPullRequest(
  context: PublishContext,
  deps: PublishDeps,
): Promise<PublishOutcome> {
  const eligibility = reVerifyEligibility(context);
  if (eligibility.kind === 'refused') return refused('POLICY_REFUSAL', eligibility.reason);
  const { diff } = eligibility;

  let installationToken: string;
  try {
    installationToken = await deps.githubAppAuth.getInstallationToken(context.githubInstallationId);
  } catch (error) {
    const { category, reason } = classifyGitHubError(error, 'other');
    return failed(category, `could not obtain an installation token: ${reason}`);
  }

  // Stale-base check: current default-branch HEAD MUST equal the exact
  // commit SHA this patch was analysed against. No rebase, no
  // three-way merge, no "probably still applies."
  let currentHeadSha: string;
  try {
    currentHeadSha = await deps.githubClient.getBranchCommitSha(
      context.repositoryOwner,
      context.repositoryName,
      context.defaultBranch,
      installationToken,
    );
  } catch (error) {
    const { category, reason } = classifyGitHubError(error, 'other');
    return failed(category, `could not verify the current default branch: ${reason}`);
  }
  if (currentHeadSha !== context.analysedCommitSha) {
    return refused(
      'STALE_BASE',
      `the repository's default branch has moved since this patch was analysed (analysed ${context.analysedCommitSha.slice(0, 7)}, current default branch is at ${currentHeadSha.slice(0, 7)}) -- re-analyse and re-verify before publishing`,
    );
  }

  const branchName = deriveBranchName(context.transformationKind, context.patchAttemptId);
  const priorCommitSha = deps.priorCommitShas[0] ?? null;

  let existingRefSha: string | null;
  try {
    existingRefSha = await deps.githubClient.getBranchRefSha(
      context.repositoryOwner,
      context.repositoryName,
      branchName,
      installationToken,
    );
  } catch (error) {
    const { category, reason } = classifyGitHubError(error, 'other');
    return failed(category, reason);
  }

  let commitSha: string;

  if (existingRefSha !== null) {
    // The branch already exists on GitHub -- reconcile, never overwrite.
    if (priorCommitSha !== null && existingRefSha === priorCommitSha) {
      commitSha = existingRefSha;
    } else {
      return failed(
        'BRANCH_COLLISION',
        `a branch named ${branchName} already exists and does not point at a commit Patchwork created for this patch attempt`,
        branchName,
      );
    }
  } else {
    // No ref yet. Reuse a still-valid prior commit object if one exists
    // (do not create an unnecessary duplicate commit); otherwise build
    // fresh from the exact snapshot + exact diff.
    let reusableCommitSha: string | null = null;
    if (priorCommitSha !== null) {
      try {
        await deps.githubClient.getCommitTreeSha(
          context.repositoryOwner,
          context.repositoryName,
          priorCommitSha,
          installationToken,
        );
        reusableCommitSha = priorCommitSha;
      } catch {
        reusableCommitSha = null;
      }
    }

    if (reusableCommitSha !== null) {
      commitSha = reusableCommitSha;
    } else {
      const built = await buildNewCommit(context, diff, deps, installationToken);
      if (built.kind !== 'ok') return built.outcome;
      commitSha = built.commitSha;
    }

    try {
      await deps.githubClient.createBranchRef(
        context.repositoryOwner,
        context.repositoryName,
        branchName,
        commitSha,
        installationToken,
      );
    } catch (error) {
      const { category, reason } = classifyGitHubError(error, 'branch_ref');
      return failed(category, reason, branchName, commitSha);
    }
  }

  // PR reconciliation: a live head-branch lookup before ever calling
  // create, so a prior attempt that created the PR but crashed before
  // persisting it is discovered and reused, never duplicated.
  try {
    const existingOpenPrs = await deps.githubClient.listOpenPullRequestsForHead(
      context.repositoryOwner,
      context.repositoryName,
      branchName,
      installationToken,
    );
    const existing = existingOpenPrs[0];
    if (existing) {
      return opened(branchName, commitSha, existing.number, existing.url);
    }

    const created = await deps.githubClient.createPullRequest(
      context.repositoryOwner,
      context.repositoryName,
      {
        title: derivePrTitle(context),
        body: derivePrBody(context, { branchName, commitSha }),
        head: branchName,
        base: context.defaultBranch,
      },
      installationToken,
    );
    return opened(branchName, commitSha, created.number, created.url);
  } catch (error) {
    const { category, reason } = classifyGitHubError(error, 'pull_request');
    return failed(category, reason, branchName, commitSha);
  }
}
