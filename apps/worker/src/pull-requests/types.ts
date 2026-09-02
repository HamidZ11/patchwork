export type PullRequestAttemptStatus = 'PENDING' | 'RUNNING' | 'OPENED' | 'REFUSED' | 'FAILED';

export type PullRequestFailureCategory =
  | 'STALE_BASE'
  | 'POLICY_REFUSAL'
  | 'GITHUB_PERMISSION_FAILURE'
  | 'GITHUB_RULESET_FAILURE'
  | 'BRANCH_COLLISION'
  | 'PATCH_APPLICATION_FAILURE'
  | 'GITHUB_API_FAILURE'
  | 'RATE_LIMITED';

export interface PublishContext {
  patchAttemptId: string;
  patchAttemptStatus: string;
  diff: string | null;
  changedFiles: string[];
  transformationKind: string;
  postconditionChecks: { name: string; passed: boolean }[];
  verificationRunId: string;
  verificationRunStatus: string;
  verificationDiffSha256: string | null;
  verificationSteps: {
    kind: string;
    status: string;
    exitCode: number | null;
  }[];
  nodeVersion: string | null;
  nodeVersionSource: string | null;
  packageManager: string | null;
  sandboxRuntime: string | null;
  repositoryOwner: string;
  repositoryName: string;
  repositoryFullName: string;
  githubInstallationId: number;
  defaultBranch: string;
  /** The exact RepositorySnapshot commit SHA the PatchAttempt's diff was generated against -- the required base for both the stale-base check and the new commit's single parent. */
  analysedCommitSha: string;
  providerChangeTitle: string;
  providerChangeSourceUrl: string;
  providerChangeExternalId: string;
  migrationRequirement: string;
}

export interface PublishOutcome {
  status: PullRequestAttemptStatus;
  failureCategory: PullRequestFailureCategory | null;
  failureReason: string | null;
  branchName: string | null;
  commitSha: string | null;
  githubPrNumber: number | null;
  githubPrUrl: string | null;
}
