import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import { LEASE_DURATION_MS } from '../verification/policy.js';

export interface ClaimedPullRequestAttempt {
  id: string;
  patchAttemptId: string;
  verificationRunId: string;
}

/**
 * Same lease-based claim mechanism as verification/queue.ts's
 * claimNextPendingRun, applied to pull_request_attempts instead --
 * deliberately duplicated rather than generalized into a shared helper
 * (the two tables' claim logic is a handful of lines; a shared/
 * parameterized abstraction isn't earned until a third table needs the
 * identical pattern). See verification/queue.ts's own doc comment for
 * the full reasoning (SELECT ... FOR UPDATE SKIP LOCKED, the lease's
 * purpose, why this is not a distributed queue framework).
 */
export async function claimNextPendingPullRequestAttempt(
  db: Database,
  workerId: string,
): Promise<ClaimedPullRequestAttempt | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: schema.pullRequestAttempts.id,
        patchAttemptId: schema.pullRequestAttempts.patchAttemptId,
        verificationRunId: schema.pullRequestAttempts.verificationRunId,
      })
      .from(schema.pullRequestAttempts)
      .where(eq(schema.pullRequestAttempts.status, 'PENDING'))
      .orderBy(schema.pullRequestAttempts.createdAt)
      .limit(1)
      .for('update', { skipLocked: true });

    if (!row) return null;

    const now = new Date();
    await tx
      .update(schema.pullRequestAttempts)
      .set({
        status: 'RUNNING',
        claimedBy: workerId,
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
        startedAt: now,
      })
      .where(eq(schema.pullRequestAttempts.id, row.id));

    return row;
  });
}

/**
 * Recovers RUNNING pull_request_attempts rows whose lease has expired --
 * classified INFRA_ERROR-equivalent (GITHUB_API_FAILURE, since there is
 * no dedicated infra category for this table -- see docs/pr-creation.md),
 * never left RUNNING forever. Per the approved v1 scope, no automatic
 * retry exists: a recovered row surfaces as a genuine, visible failure
 * the user can act on by explicitly requesting another attempt, which
 * (per the approved recovery correction) reconciles against live GitHub
 * state rather than assuming the crashed attempt's writes never happened.
 */
export async function recoverStalePullRequestClaims(db: Database): Promise<number> {
  const now = new Date();
  const result = await db
    .update(schema.pullRequestAttempts)
    .set({
      status: 'FAILED',
      failureCategory: 'GITHUB_API_FAILURE',
      failureReason:
        'worker lease expired before the pull request attempt completed (worker crash or restart)',
      completedAt: now,
    })
    .where(
      and(
        eq(schema.pullRequestAttempts.status, 'RUNNING'),
        or(
          isNull(schema.pullRequestAttempts.leaseExpiresAt),
          lt(schema.pullRequestAttempts.leaseExpiresAt, now),
        ),
      ),
    )
    .returning({ id: schema.pullRequestAttempts.id });

  return result.length;
}

export async function renewPullRequestLease(
  db: Database,
  pullRequestAttemptId: string,
): Promise<void> {
  await db
    .update(schema.pullRequestAttempts)
    .set({ leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS) })
    .where(eq(schema.pullRequestAttempts.id, pullRequestAttemptId));
}
