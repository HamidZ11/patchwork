import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';

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

export interface AnalysisRunDto {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  analyzerVersion: string;
}

/**
 * Idempotently upserts the RepositorySnapshot (unique on repository_id +
 * commit_sha -- "scan the same commit twice" converges to one row) and
 * always inserts a new AnalysisRun referencing it, in one transaction.
 * AnalysisRun is deliberately NOT deduplicated: each call is a distinct
 * execution/audit record, not an idempotent resource, so multiple runs
 * may legitimately point at the same snapshot.
 */
export async function upsertSnapshotAndCreateRun(
  db: Database,
  params: {
    repositoryId: string;
    commitSha: string;
    ref: string;
    acquisitionMethod: string;
    analyzerVersion: string;
    triggeredByUserId: string;
    startedAt: Date;
    completedAt: Date;
  },
): Promise<{ snapshot: SnapshotDto; analysisRun: AnalysisRunDto }> {
  return db.transaction(async (tx) => {
    const [snapshot] = await tx
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

    const [analysisRun] = await tx
      .insert(schema.analysisRuns)
      .values({
        repositorySnapshotId: snapshot.id,
        triggeredByUserId: params.triggeredByUserId,
        analyzerVersion: params.analyzerVersion,
        status: 'completed',
        startedAt: params.startedAt,
        completedAt: params.completedAt,
      })
      .returning();

    if (!analysisRun) throw new Error('failed to create analysis run');

    return {
      snapshot: {
        id: snapshot.id,
        commitSha: snapshot.commitSha,
        ref: snapshot.ref,
        createdAt: snapshot.createdAt,
      },
      analysisRun: {
        id: analysisRun.id,
        status: analysisRun.status,
        startedAt: analysisRun.startedAt,
        completedAt: analysisRun.completedAt,
        analyzerVersion: analysisRun.analyzerVersion,
      },
    };
  });
}

export interface LatestAnalysis {
  commitSha: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
}

/**
 * The most recent AnalysisRun per repository, for repositories that have
 * ever been analyzed. Fetches all matching runs ordered by recency and
 * keeps the first occurrence per repository in application code, rather
 * than a window-function query -- simple and correct at the data volumes
 * this system has today.
 */
export async function getLatestAnalysisForRepositories(
  db: Database,
  repositoryIds: string[],
): Promise<Map<string, LatestAnalysis>> {
  if (repositoryIds.length === 0) return new Map();

  const rows = await db
    .select({
      repositoryId: schema.repositorySnapshots.repositoryId,
      commitSha: schema.repositorySnapshots.commitSha,
      status: schema.analysisRuns.status,
      startedAt: schema.analysisRuns.startedAt,
      completedAt: schema.analysisRuns.completedAt,
    })
    .from(schema.analysisRuns)
    .innerJoin(
      schema.repositorySnapshots,
      eq(schema.analysisRuns.repositorySnapshotId, schema.repositorySnapshots.id),
    )
    .where(inArray(schema.repositorySnapshots.repositoryId, repositoryIds))
    .orderBy(desc(schema.analysisRuns.startedAt));

  const latest = new Map<string, LatestAnalysis>();
  for (const row of rows) {
    if (!latest.has(row.repositoryId)) {
      latest.set(row.repositoryId, {
        commitSha: row.commitSha,
        status: row.status,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
      });
    }
  }
  return latest;
}
