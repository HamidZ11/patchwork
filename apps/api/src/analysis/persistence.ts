import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import type { StripeEvidence } from './evidence/types.js';
import { STRIPE_EVIDENCE_SCHEMA_VERSION } from './evidence/types.js';

export interface RepositoryForAnalysis {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  githubInstallationId: number;
}

/**
 * Looks up a repository by our internal id, scoped to installations the
 * given user connected. Returns null (never throws) if the repository
 * doesn't exist OR belongs to someone else's installation -- callers
 * should treat both the same way (404), so a repository id's existence is
 * never leaked to a non-owner.
 */
export async function getRepositoryForUser(
  db: Database,
  userId: string,
  repositoryId: string,
): Promise<RepositoryForAnalysis | null> {
  const [row] = await db
    .select({
      id: schema.repositories.id,
      owner: schema.repositories.owner,
      name: schema.repositories.name,
      defaultBranch: schema.repositories.defaultBranch,
      githubInstallationId: schema.githubInstallations.githubInstallationId,
    })
    .from(schema.repositories)
    .innerJoin(
      schema.githubInstallations,
      eq(schema.repositories.installationId, schema.githubInstallations.id),
    )
    .where(
      and(
        eq(schema.repositories.id, repositoryId),
        eq(schema.githubInstallations.connectedByUserId, userId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export interface SnapshotDto {
  id: string;
  commitSha: string;
  ref: string;
  createdAt: Date;
}

/**
 * Idempotently upserts the RepositorySnapshot -- unique on repository_id +
 * commit_sha, so scanning the same commit twice converges to one row.
 * Separate from AnalysisRun creation: this happens before archive
 * acquisition, which can independently succeed or fail (see
 * createAnalysisRun below).
 */
export async function upsertSnapshot(
  db: Database,
  params: { repositoryId: string; commitSha: string; ref: string; acquisitionMethod: string },
): Promise<SnapshotDto> {
  const [snapshot] = await db
    .insert(schema.repositorySnapshots)
    .values({
      repositoryId: params.repositoryId,
      commitSha: params.commitSha,
      ref: params.ref,
      acquisitionMethod: params.acquisitionMethod,
    })
    .onConflictDoUpdate({
      target: [schema.repositorySnapshots.repositoryId, schema.repositorySnapshots.commitSha],
      set: { ref: params.ref, acquisitionMethod: params.acquisitionMethod },
    })
    .returning();

  if (!snapshot) throw new Error('failed to upsert repository snapshot');

  return {
    id: snapshot.id,
    commitSha: snapshot.commitSha,
    ref: snapshot.ref,
    createdAt: snapshot.createdAt,
  };
}

export interface AnalysisRunDto {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  analyzerVersion: string;
}

/**
 * Creates an AnalysisRun with its final, already-known outcome -- never an
 * interim 'running' write. A 'completed' run is inserted together with its
 * analysis_evidence row in one transaction (so a 'completed' run always
 * has evidence, and a 'failed' run never does -- no partially-written
 * state is ever observable). Not deduplicated: every trigger is its own
 * execution/audit record, so multiple runs may legitimately point at the
 * same snapshot.
 */
export async function createAnalysisRun(
  db: Database,
  params: {
    repositorySnapshotId: string;
    triggeredByUserId: string;
    analyzerVersion: string;
    startedAt: Date;
    completedAt: Date;
  } & ({ status: 'completed'; evidence: StripeEvidence } | { status: 'failed' }),
): Promise<{ analysisRun: AnalysisRunDto; evidence: StripeEvidence | null }> {
  return db.transaction(async (tx) => {
    const [analysisRun] = await tx
      .insert(schema.analysisRuns)
      .values({
        repositorySnapshotId: params.repositorySnapshotId,
        triggeredByUserId: params.triggeredByUserId,
        analyzerVersion: params.analyzerVersion,
        status: params.status,
        startedAt: params.startedAt,
        completedAt: params.completedAt,
      })
      .returning();

    if (!analysisRun) throw new Error('failed to create analysis run');

    let evidence: StripeEvidence | null = null;
    if (params.status === 'completed') {
      await tx.insert(schema.analysisEvidence).values({
        analysisRunId: analysisRun.id,
        schemaVersion: STRIPE_EVIDENCE_SCHEMA_VERSION,
        evidence: params.evidence,
      });
      evidence = params.evidence;
    }

    return {
      analysisRun: {
        id: analysisRun.id,
        status: analysisRun.status,
        startedAt: analysisRun.startedAt,
        completedAt: analysisRun.completedAt,
        analyzerVersion: analysisRun.analyzerVersion,
      },
      evidence,
    };
  });
}

export interface LatestAnalysisStripeSummary {
  resolvedVersion: string | null;
  declaredRange: string;
  workspacePath: string;
}

export interface LatestAnalysis {
  analysisRunId: string;
  commitSha: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  stripe: LatestAnalysisStripeSummary | null;
}

/**
 * The most recent AnalysisRun per repository, for repositories that have
 * ever been analyzed. Fetches all matching runs ordered by recency and
 * keeps the first occurrence per repository in application code, rather
 * than a window-function query -- simple and correct at the data volumes
 * this system has today. `stripe` is a condensed summary (first
 * installedSdks[] entry, if any) for the repositories list UI -- not the
 * full evidence blob.
 */
export async function getLatestAnalysisForRepositories(
  db: Database,
  repositoryIds: string[],
): Promise<Map<string, LatestAnalysis>> {
  if (repositoryIds.length === 0) return new Map();

  const rows = await db
    .select({
      analysisRunId: schema.analysisRuns.id,
      repositoryId: schema.repositorySnapshots.repositoryId,
      commitSha: schema.repositorySnapshots.commitSha,
      status: schema.analysisRuns.status,
      startedAt: schema.analysisRuns.startedAt,
      completedAt: schema.analysisRuns.completedAt,
      evidence: schema.analysisEvidence.evidence,
    })
    .from(schema.analysisRuns)
    .innerJoin(
      schema.repositorySnapshots,
      eq(schema.analysisRuns.repositorySnapshotId, schema.repositorySnapshots.id),
    )
    .leftJoin(
      schema.analysisEvidence,
      eq(schema.analysisEvidence.analysisRunId, schema.analysisRuns.id),
    )
    .where(inArray(schema.repositorySnapshots.repositoryId, repositoryIds))
    .orderBy(desc(schema.analysisRuns.startedAt));

  const latest = new Map<string, LatestAnalysis>();
  for (const row of rows) {
    if (latest.has(row.repositoryId)) continue;

    const evidence = row.evidence as StripeEvidence | null;
    const firstSdk = evidence?.installedSdks[0];

    latest.set(row.repositoryId, {
      analysisRunId: row.analysisRunId,
      commitSha: row.commitSha,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      stripe: firstSdk
        ? {
            resolvedVersion: firstSdk.resolvedVersion,
            declaredRange: firstSdk.declaredRange,
            workspacePath: firstSdk.workspacePath,
          }
        : null,
    });
  }
  return latest;
}
