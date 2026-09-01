import { eq } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import type { VerificationManifest, VerificationOutcome } from './types.js';

/**
 * Creates a new PENDING VerificationRun -- audit-log style like
 * PatchAttempt/AnalysisRun, never upserted: each call is its own
 * historical attempt.
 */
export async function createVerificationRun(
  db: Database,
  patchAttemptId: string,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(schema.verificationRuns)
    .values({ patchAttemptId, status: 'PENDING' })
    .returning({ id: schema.verificationRuns.id });
  if (!row) throw new Error('failed to create verification run');
  return row;
}

export interface PatchAttemptForVerification {
  id: string;
  status: string;
  diff: string | null;
  changedFiles: string[];
  repositoryOwner: string;
  repositoryName: string;
  githubInstallationId: number;
  commitSha: string;
}

/**
 * Everything needed to run verification for one PatchAttempt, joined
 * from patch_attempts through impact_assessments -> analysis_runs ->
 * repository_snapshots -> repositories -> github_installations -- same
 * join shape as getImpactAssessmentForUser, minus the user-ownership
 * filter (verification always runs against a PatchAttempt the worker
 * already knows is real; ownership was already enforced when the
 * VerificationRun's PENDING row was created via the API route).
 */
export async function getPatchAttemptForVerification(
  db: Database,
  patchAttemptId: string,
): Promise<PatchAttemptForVerification | null> {
  const [row] = await db
    .select({
      id: schema.patchAttempts.id,
      status: schema.patchAttempts.status,
      diff: schema.patchAttempts.diff,
      changedFiles: schema.patchAttempts.changedFiles,
      repositoryOwner: schema.repositories.owner,
      repositoryName: schema.repositories.name,
      githubInstallationId: schema.githubInstallations.githubInstallationId,
      commitSha: schema.repositorySnapshots.commitSha,
    })
    .from(schema.patchAttempts)
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
    .where(eq(schema.patchAttempts.id, patchAttemptId))
    .limit(1);

  return row ?? null;
}

export async function completeVerificationRun(
  db: Database,
  verificationRunId: string,
  outcome: VerificationOutcome,
  manifest: VerificationManifest | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.verificationRuns)
      .set({
        status: outcome.status,
        failureCategory: outcome.failureCategory,
        failureReason: outcome.failureReason,
        manifestVersion: manifest ? String(manifest.version) : null,
        manifest: manifest ?? null,
        sandboxProvider: manifest ? 'e2b' : null,
        sandboxRuntime: outcome.sandboxRuntime,
        nodeVersion: manifest?.runtime.node.version ?? null,
        nodeVersionSource: manifest?.runtime.node.source ?? null,
        packageManager: manifest?.runtime.packageManager.name ?? null,
        resultSummary: {
          stepsRun: outcome.steps.length,
          stepsPassed: outcome.steps.filter((s) => s.status === 'PASSED').length,
        },
        completedAt: new Date(),
      })
      .where(eq(schema.verificationRuns.id, verificationRunId));

    if (outcome.steps.length > 0) {
      await tx.insert(schema.verificationSteps).values(
        outcome.steps.map((step) => ({
          verificationRunId,
          sequence: step.sequence,
          kind: step.kind,
          command: step.command,
          status: step.status,
          exitCode: step.exitCode,
          timedOut: step.timedOut,
          durationMs: step.durationMs,
          stdoutExcerpt: step.stdoutExcerpt,
          stderrExcerpt: step.stderrExcerpt,
          truncated: step.truncated,
          startedAt: step.startedAt,
          completedAt: step.completedAt,
        })),
      );
    }
  });
}
