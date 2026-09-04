import { and, desc, eq, ne } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import type { PublishContext, PublishOutcome } from './types.js';

interface VerificationManifestShape {
  patch?: { diffSha256?: string };
}

/** Matches apps/api/src/remediation/types.ts's PostconditionCheck shape (patch_attempts.postcondition_result's persisted jsonb) -- not re-imported across the app boundary, per ADR-001. */
interface PersistedPostconditionCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Everything the worker needs to publish one PullRequestAttempt, joined
 * from pull_request_attempts through patch_attempts -> impact_assessments
 * -> rule_versions -> provider_changes, and separately through
 * analysis_runs -> repository_snapshots -> repositories ->
 * github_installations, plus the linked verification_run and its steps.
 * No ownership filter here -- the same trust boundary as
 * getPatchAttemptForVerification: ownership was already enforced when the
 * PENDING row was created via the API route.
 */
export async function getPublishContext(
  db: Database,
  pullRequestAttemptId: string,
): Promise<PublishContext | null> {
  const [row] = await db
    .select({
      patchAttemptId: schema.patchAttempts.id,
      impactAssessmentId: schema.impactAssessments.id,
      patchAttemptStatus: schema.patchAttempts.status,
      diff: schema.patchAttempts.diff,
      changedFiles: schema.patchAttempts.changedFiles,
      transformationKind: schema.patchAttempts.transformationKind,
      postconditionResult: schema.patchAttempts.postconditionResult,
      verificationRunId: schema.verificationRuns.id,
      verificationRunStatus: schema.verificationRuns.status,
      verificationManifest: schema.verificationRuns.manifest,
      nodeVersion: schema.verificationRuns.nodeVersion,
      nodeVersionSource: schema.verificationRuns.nodeVersionSource,
      packageManager: schema.verificationRuns.packageManager,
      sandboxRuntime: schema.verificationRuns.sandboxRuntime,
      repositoryOwner: schema.repositories.owner,
      repositoryName: schema.repositories.name,
      repositoryFullName: schema.repositories.fullName,
      defaultBranch: schema.repositories.defaultBranch,
      githubInstallationId: schema.githubInstallations.githubInstallationId,
      analysedCommitSha: schema.repositorySnapshots.commitSha,
      providerChangeTitle: schema.providerChanges.title,
      providerChangeSourceUrl: schema.providerChanges.sourceUrl,
      providerChangeExternalId: schema.providerChanges.externalId,
      migrationRequirement: schema.ruleVersions.migrationRequirement,
    })
    .from(schema.pullRequestAttempts)
    .innerJoin(
      schema.patchAttempts,
      eq(schema.pullRequestAttempts.patchAttemptId, schema.patchAttempts.id),
    )
    .innerJoin(
      schema.verificationRuns,
      eq(schema.pullRequestAttempts.verificationRunId, schema.verificationRuns.id),
    )
    .innerJoin(
      schema.impactAssessments,
      eq(schema.patchAttempts.impactAssessmentId, schema.impactAssessments.id),
    )
    .innerJoin(
      schema.ruleVersions,
      eq(schema.impactAssessments.ruleVersionId, schema.ruleVersions.id),
    )
    .innerJoin(
      schema.providerChanges,
      eq(schema.ruleVersions.providerChangeId, schema.providerChanges.id),
    )
    .innerJoin(
      schema.analysisRuns,
      eq(schema.impactAssessments.analysisRunId, schema.analysisRuns.id),
    )
    .innerJoin(
      schema.repositorySnapshots,
      eq(schema.analysisRuns.repositorySnapshotId, schema.repositorySnapshots.id),
    )
    .innerJoin(
      schema.repositories,
      eq(schema.repositorySnapshots.repositoryId, schema.repositories.id),
    )
    .innerJoin(
      schema.githubInstallations,
      eq(schema.repositories.installationId, schema.githubInstallations.id),
    )
    .where(eq(schema.pullRequestAttempts.id, pullRequestAttemptId))
    .limit(1);

  if (!row) return null;

  const stepRows = await db
    .select({
      kind: schema.verificationSteps.kind,
      status: schema.verificationSteps.status,
      exitCode: schema.verificationSteps.exitCode,
    })
    .from(schema.verificationSteps)
    .where(eq(schema.verificationSteps.verificationRunId, row.verificationRunId))
    .orderBy(schema.verificationSteps.sequence);

  const manifest = row.verificationManifest as VerificationManifestShape | null;

  return {
    patchAttemptId: row.patchAttemptId,
    impactAssessmentId: row.impactAssessmentId,
    patchAttemptStatus: row.patchAttemptStatus,
    diff: row.diff,
    changedFiles: row.changedFiles,
    transformationKind: row.transformationKind,
    postconditionChecks: (
      (row.postconditionResult as PersistedPostconditionCheck[] | null) ?? []
    ).map((check) => ({ name: check.name, passed: check.passed })),
    verificationRunId: row.verificationRunId,
    verificationRunStatus: row.verificationRunStatus,
    verificationDiffSha256: manifest?.patch?.diffSha256 ?? null,
    verificationSteps: stepRows,
    nodeVersion: row.nodeVersion,
    nodeVersionSource: row.nodeVersionSource,
    packageManager: row.packageManager,
    sandboxRuntime: row.sandboxRuntime,
    repositoryOwner: row.repositoryOwner,
    repositoryName: row.repositoryName,
    repositoryFullName: row.repositoryFullName,
    githubInstallationId: row.githubInstallationId,
    defaultBranch: row.defaultBranch,
    analysedCommitSha: row.analysedCommitSha,
    providerChangeTitle: row.providerChangeTitle,
    providerChangeSourceUrl: row.providerChangeSourceUrl,
    providerChangeExternalId: row.providerChangeExternalId,
    migrationRequirement: row.migrationRequirement,
  };
}

/**
 * The still-OPENED Patchwork pull request for this attempt's assessment,
 * if one was opened from a DIFFERENT PatchAttempt of the same assessment.
 *
 * Publication is an assessment-level fact, not a per-attempt one: re-running
 * "Prepare fix" appends a new PatchAttempt for the same change, so a
 * per-attempt lookup cannot see a PR Patchwork already opened for it. Read
 * immediately before the GitHub write (rather than only at enqueue time in the
 * API) because this is the point a duplicate would actually become visible to
 * the customer. Attempts on this same PatchAttempt are excluded -- those are
 * resumes of one attempt, reconciled against GitHub itself by run.ts.
 */
export async function findAssessmentOpenedPullRequest(
  db: Database,
  impactAssessmentId: string,
  excludePatchAttemptId: string,
): Promise<{ githubPrNumber: number | null; githubPrUrl: string | null } | null> {
  const [row] = await db
    .select({
      githubPrNumber: schema.pullRequestAttempts.githubPrNumber,
      githubPrUrl: schema.pullRequestAttempts.githubPrUrl,
    })
    .from(schema.pullRequestAttempts)
    .innerJoin(
      schema.patchAttempts,
      eq(schema.pullRequestAttempts.patchAttemptId, schema.patchAttempts.id),
    )
    .where(
      and(
        eq(schema.patchAttempts.impactAssessmentId, impactAssessmentId),
        eq(schema.pullRequestAttempts.status, 'OPENED'),
        ne(schema.pullRequestAttempts.patchAttemptId, excludePatchAttemptId),
      ),
    )
    .orderBy(desc(schema.pullRequestAttempts.createdAt))
    .limit(1);

  return row ?? null;
}

/**
 * Every PullRequestAttempt belonging to a given PatchAttempt, newest
 * first -- used by the recovery/reconciliation path to find a prior
 * attempt's persisted branch_name/commit_sha before touching GitHub, and
 * by the API's duplicate-prevention checks.
 */
export async function getPullRequestAttemptsForPatchAttempt(
  db: Database,
  patchAttemptId: string,
): Promise<
  {
    id: string;
    status: string;
    branchName: string | null;
    commitSha: string | null;
    githubPrNumber: number | null;
    githubPrUrl: string | null;
  }[]
> {
  return db
    .select({
      id: schema.pullRequestAttempts.id,
      status: schema.pullRequestAttempts.status,
      branchName: schema.pullRequestAttempts.branchName,
      commitSha: schema.pullRequestAttempts.commitSha,
      githubPrNumber: schema.pullRequestAttempts.githubPrNumber,
      githubPrUrl: schema.pullRequestAttempts.githubPrUrl,
    })
    .from(schema.pullRequestAttempts)
    .where(eq(schema.pullRequestAttempts.patchAttemptId, patchAttemptId))
    .orderBy(desc(schema.pullRequestAttempts.createdAt));
}

export async function completePullRequestAttempt(
  db: Database,
  pullRequestAttemptId: string,
  outcome: PublishOutcome,
): Promise<void> {
  await db
    .update(schema.pullRequestAttempts)
    .set({
      status: outcome.status,
      failureCategory: outcome.failureCategory,
      failureReason: outcome.failureReason,
      branchName: outcome.branchName,
      commitSha: outcome.commitSha,
      githubPrNumber: outcome.githubPrNumber,
      githubPrUrl: outcome.githubPrUrl,
      completedAt: new Date(),
    })
    .where(eq(schema.pullRequestAttempts.id, pullRequestAttemptId));
}
