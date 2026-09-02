import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';

const FORBIDDEN_PATH_PATTERNS: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)\.github\//,
];

export interface VerificationRunForPublish {
  id: string;
  status: string;
  patchAttemptId: string;
  patchAttemptStatus: string;
  diff: string | null;
  changedFiles: string[];
  manifestDiffSha256: string | null;
  repositoryOwner: string;
  repositoryName: string;
  githubInstallationId: number;
}

interface VerificationManifestShape {
  patch?: { diffSha256?: string };
}

/**
 * Looks up a VerificationRun by id, scoped to installations the given
 * user connected -- same ownership-join pattern as
 * getPatchAttemptForUser, extended two hops further (verification_runs ->
 * patch_attempts). Returns null (never throws) if the run doesn't exist
 * or isn't owned by userId. Includes exactly what the publish-eligibility
 * checks and the live PR-status recheck need, nothing else.
 */
export async function getVerificationRunForPublish(
  db: Database,
  userId: string,
  verificationRunId: string,
): Promise<VerificationRunForPublish | null> {
  const [row] = await db
    .select({
      id: schema.verificationRuns.id,
      status: schema.verificationRuns.status,
      manifest: schema.verificationRuns.manifest,
      patchAttemptId: schema.patchAttempts.id,
      patchAttemptStatus: schema.patchAttempts.status,
      diff: schema.patchAttempts.diff,
      changedFiles: schema.patchAttempts.changedFiles,
      repositoryOwner: schema.repositories.owner,
      repositoryName: schema.repositories.name,
      githubInstallationId: schema.githubInstallations.githubInstallationId,
    })
    .from(schema.verificationRuns)
    .innerJoin(
      schema.patchAttempts,
      eq(schema.verificationRuns.patchAttemptId, schema.patchAttempts.id),
    )
    .innerJoin(
      schema.impactAssessments,
      eq(schema.patchAttempts.impactAssessmentId, schema.impactAssessments.id),
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
    .where(
      and(
        eq(schema.verificationRuns.id, verificationRunId),
        eq(schema.githubInstallations.connectedByUserId, userId),
      ),
    )
    .limit(1);

  if (!row) return null;

  const manifest = row.manifest as VerificationManifestShape | null;

  return {
    id: row.id,
    status: row.status,
    patchAttemptId: row.patchAttemptId,
    patchAttemptStatus: row.patchAttemptStatus,
    diff: row.diff,
    changedFiles: row.changedFiles,
    manifestDiffSha256: manifest?.patch?.diffSha256 ?? null,
    repositoryOwner: row.repositoryOwner,
    repositoryName: row.repositoryName,
    githubInstallationId: row.githubInstallationId,
  };
}

/**
 * Every eligibility rule that can be checked purely from already-fetched
 * DB state, before any GitHub call -- ownership, PatchAttempt/
 * VerificationRun status, verified-diff-hash match, and forbidden-path
 * re-check. The one rule that needs a live GitHub call (current default
 * branch HEAD) is deliberately NOT checked here -- it happens inside the
 * worker's publish run, immediately before any write, matching the same
 * API-authorizes/worker-executes split used by verification.
 */
export function checkOfflineEligibility(
  row: VerificationRunForPublish,
): { kind: 'ok' } | { kind: 'refused'; reason: string } {
  if (row.patchAttemptStatus !== 'GENERATED') {
    return {
      kind: 'refused',
      reason: `Patch attempt status is ${row.patchAttemptStatus}, not GENERATED -- nothing to publish.`,
    };
  }
  if (row.status !== 'PASSED') {
    return {
      kind: 'refused',
      reason: `Verification run status is ${row.status}, not PASSED -- only a passed sandbox verification may authorize publishing.`,
    };
  }
  if (!row.diff || row.changedFiles.length === 0) {
    return { kind: 'refused', reason: 'Patch attempt has no diff to publish.' };
  }
  const actualDiffSha256 = createHash('sha256').update(row.diff).digest('hex');
  if (row.manifestDiffSha256 !== actualDiffSha256) {
    return {
      kind: 'refused',
      reason: 'The verified diff hash does not match the current patch attempt diff.',
    };
  }
  for (const path of row.changedFiles) {
    if (FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
      return { kind: 'refused', reason: `${path} is a forbidden path for automatic publication.` };
    }
  }
  return { kind: 'ok' };
}

export interface PersistedPullRequestAttempt {
  id: string;
  status: string;
  failureCategory: string | null;
  failureReason: string | null;
  branchName: string | null;
  commitSha: string | null;
  githubPrNumber: number | null;
  githubPrUrl: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

/** Every PullRequestAttempt for a PatchAttempt, newest first -- used for the in-flight and existing-OPENED guards. */
export async function getPullRequestAttemptsForPatchAttempt(
  db: Database,
  patchAttemptId: string,
): Promise<PersistedPullRequestAttempt[]> {
  return db
    .select({
      id: schema.pullRequestAttempts.id,
      status: schema.pullRequestAttempts.status,
      failureCategory: schema.pullRequestAttempts.failureCategory,
      failureReason: schema.pullRequestAttempts.failureReason,
      branchName: schema.pullRequestAttempts.branchName,
      commitSha: schema.pullRequestAttempts.commitSha,
      githubPrNumber: schema.pullRequestAttempts.githubPrNumber,
      githubPrUrl: schema.pullRequestAttempts.githubPrUrl,
      createdAt: schema.pullRequestAttempts.createdAt,
      completedAt: schema.pullRequestAttempts.completedAt,
    })
    .from(schema.pullRequestAttempts)
    .where(eq(schema.pullRequestAttempts.patchAttemptId, patchAttemptId))
    .orderBy(desc(schema.pullRequestAttempts.createdAt));
}

export async function createPendingPullRequestAttempt(
  db: Database,
  params: { patchAttemptId: string; verificationRunId: string },
): Promise<PersistedPullRequestAttempt> {
  const [row] = await db
    .insert(schema.pullRequestAttempts)
    .values({
      patchAttemptId: params.patchAttemptId,
      verificationRunId: params.verificationRunId,
      status: 'PENDING',
    })
    .returning();
  if (!row) throw new Error('failed to create pull request attempt');
  return row;
}

export interface PullRequestAttemptDetail extends PersistedPullRequestAttempt {
  patchAttemptId: string;
  verificationRunId: string;
}

/** Ownership-scoped full detail for one PullRequestAttempt -- same join shape as getVerificationRunForPublish, entered from the other end. */
export async function getPullRequestAttemptForUser(
  db: Database,
  userId: string,
  pullRequestAttemptId: string,
): Promise<PullRequestAttemptDetail | null> {
  const [row] = await db
    .select({
      id: schema.pullRequestAttempts.id,
      status: schema.pullRequestAttempts.status,
      failureCategory: schema.pullRequestAttempts.failureCategory,
      failureReason: schema.pullRequestAttempts.failureReason,
      branchName: schema.pullRequestAttempts.branchName,
      commitSha: schema.pullRequestAttempts.commitSha,
      githubPrNumber: schema.pullRequestAttempts.githubPrNumber,
      githubPrUrl: schema.pullRequestAttempts.githubPrUrl,
      createdAt: schema.pullRequestAttempts.createdAt,
      completedAt: schema.pullRequestAttempts.completedAt,
      patchAttemptId: schema.pullRequestAttempts.patchAttemptId,
      verificationRunId: schema.pullRequestAttempts.verificationRunId,
    })
    .from(schema.pullRequestAttempts)
    .innerJoin(
      schema.patchAttempts,
      eq(schema.pullRequestAttempts.patchAttemptId, schema.patchAttempts.id),
    )
    .innerJoin(
      schema.impactAssessments,
      eq(schema.patchAttempts.impactAssessmentId, schema.impactAssessments.id),
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
    .where(
      and(
        eq(schema.pullRequestAttempts.id, pullRequestAttemptId),
        eq(schema.githubInstallations.connectedByUserId, userId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export function isActiveStatus(status: string): boolean {
  return status === 'PENDING' || status === 'RUNNING';
}

/**
 * Every PullRequestAttempt for a set of PatchAttempts, newest first per
 * attempt -- batched counterpart to getPullRequestAttemptsForPatchAttempt,
 * mirroring getVerificationRunsForPatchAttempts' inArray shape exactly, for
 * the impact-detail page (one query instead of one per patch attempt).
 * Ownership is already enforced by the caller (getAnalysisRunDetail scopes
 * patchAttemptIds to the requesting user's own analysis run before this is
 * ever called), same trust boundary as getVerificationRunsForPatchAttempts.
 */
export async function getPullRequestAttemptsForPatchAttempts(
  db: Database,
  patchAttemptIds: string[],
): Promise<Map<string, PersistedPullRequestAttempt[]>> {
  const result = new Map<string, PersistedPullRequestAttempt[]>();
  if (patchAttemptIds.length === 0) return result;

  const rows = await db
    .select({
      id: schema.pullRequestAttempts.id,
      status: schema.pullRequestAttempts.status,
      failureCategory: schema.pullRequestAttempts.failureCategory,
      failureReason: schema.pullRequestAttempts.failureReason,
      branchName: schema.pullRequestAttempts.branchName,
      commitSha: schema.pullRequestAttempts.commitSha,
      githubPrNumber: schema.pullRequestAttempts.githubPrNumber,
      githubPrUrl: schema.pullRequestAttempts.githubPrUrl,
      createdAt: schema.pullRequestAttempts.createdAt,
      completedAt: schema.pullRequestAttempts.completedAt,
      patchAttemptId: schema.pullRequestAttempts.patchAttemptId,
    })
    .from(schema.pullRequestAttempts)
    .where(inArray(schema.pullRequestAttempts.patchAttemptId, patchAttemptIds))
    .orderBy(desc(schema.pullRequestAttempts.createdAt));

  for (const { patchAttemptId, ...attempt } of rows) {
    const list = result.get(patchAttemptId) ?? [];
    list.push(attempt);
    result.set(patchAttemptId, list);
  }
  return result;
}
