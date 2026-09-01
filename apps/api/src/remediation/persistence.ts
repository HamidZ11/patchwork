import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import type { GeneratePatchAttemptResult } from './types.js';

export interface PersistedPatchAttempt {
  id: string;
  status: string;
  transformationKind: string;
  transformationVersion: string;
  refusalReason: string | null;
  failureReason: string | null;
  changedFiles: string[];
  diff: string | null;
  postconditionResult: unknown;
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Audit-log style, like AnalysisRun -- never upserted. Each POST is its
 * own historical attempt, not a pure function of its inputs (a future
 * transformation_version bump can legitimately produce a different
 * result for the same assessment).
 */
export async function createPatchAttempt(
  db: Database,
  params: {
    impactAssessmentId: string;
    transformationKind: string;
    transformationVersion: string;
    result: GeneratePatchAttemptResult;
  },
): Promise<PersistedPatchAttempt> {
  const [row] = await db
    .insert(schema.patchAttempts)
    .values({
      impactAssessmentId: params.impactAssessmentId,
      transformationKind: params.transformationKind,
      transformationVersion: params.transformationVersion,
      status: params.result.status,
      refusalReason: params.result.refusalReason ?? null,
      failureReason: params.result.failureReason ?? null,
      changedFiles: params.result.changedFiles,
      diff: params.result.diff ?? null,
      postconditionResult: params.result.postconditionResult ?? null,
      completedAt: new Date(),
    })
    .returning();
  if (!row) throw new Error('failed to persist patch attempt');
  return row;
}

/**
 * Every attempt for a set of assessments, most-recent-first per
 * assessment -- same grouping shape as
 * getImpactAssessmentsForAnalysisRuns, for the impact-detail page to
 * render alongside each assessment.
 */
export async function getPatchAttemptsForAssessments(
  db: Database,
  impactAssessmentIds: string[],
): Promise<Map<string, PersistedPatchAttempt[]>> {
  const result = new Map<string, PersistedPatchAttempt[]>();
  if (impactAssessmentIds.length === 0) return result;

  const rows = await db
    .select()
    .from(schema.patchAttempts)
    .where(inArray(schema.patchAttempts.impactAssessmentId, impactAssessmentIds))
    .orderBy(desc(schema.patchAttempts.createdAt));

  for (const row of rows) {
    const list = result.get(row.impactAssessmentId) ?? [];
    list.push(row);
    result.set(row.impactAssessmentId, list);
  }
  return result;
}

export interface PatchAttemptOwnershipRow {
  id: string;
  status: string;
}

/**
 * Looks up a PatchAttempt by id, scoped to installations the given user
 * connected -- same ownership-join pattern as getImpactAssessmentForUser,
 * extended one hop further (patch_attempts -> impact_assessments).
 * Returns null (never throws) if the attempt doesn't exist or isn't
 * owned by userId -- never leaks a patch attempt id's existence to a
 * non-owner.
 */
export async function getPatchAttemptForUser(
  db: Database,
  userId: string,
  patchAttemptId: string,
): Promise<PatchAttemptOwnershipRow | null> {
  const [row] = await db
    .select({ id: schema.patchAttempts.id, status: schema.patchAttempts.status })
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
    .where(
      and(
        eq(schema.patchAttempts.id, patchAttemptId),
        eq(schema.githubInstallations.connectedByUserId, userId),
      ),
    )
    .limit(1);

  return row ?? null;
}
