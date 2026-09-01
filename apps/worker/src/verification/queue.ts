import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import { LEASE_DURATION_MS } from './policy.js';

export interface ClaimedRun {
  id: string;
  patchAttemptId: string;
}

/**
 * Claims one PENDING row (or a RUNNING row whose lease has expired --
 * see recoverStaleClaims below) for this worker, atomically, using
 * Postgres' own row-locking rather than a separate queue system --
 * `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction means two
 * workers racing for the same row never both win it, and a worker busy
 * with other rows is simply skipped over, not blocked on. This is the
 * whole queue: no new infrastructure class, matching ADR-002's "Postgres
 * is the only datastore" stance.
 *
 * The lease (`claimed_by`/`claimed_at`/`lease_expires_at`) exists so a
 * worker crash mid-run can never leave a row permanently RUNNING: if this
 * worker dies before completing, the row's lease simply expires and
 * `recoverStaleClaims` (called by any worker on its next poll) reclaims
 * it as INFRA_ERROR. This is a lease, not a distributed queue framework.
 */
export async function claimNextPendingRun(
  db: Database,
  workerId: string,
): Promise<ClaimedRun | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: schema.verificationRuns.id,
        patchAttemptId: schema.verificationRuns.patchAttemptId,
      })
      .from(schema.verificationRuns)
      .where(eq(schema.verificationRuns.status, 'PENDING'))
      .orderBy(schema.verificationRuns.createdAt)
      .limit(1)
      .for('update', { skipLocked: true });

    if (!row) return null;

    const now = new Date();
    await tx
      .update(schema.verificationRuns)
      .set({
        status: 'RUNNING',
        claimedBy: workerId,
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
        startedAt: now,
      })
      .where(eq(schema.verificationRuns.id, row.id));

    return row;
  });
}

/**
 * Recovers RUNNING rows whose lease has expired (the worker that claimed
 * them died, or ran past its own lease without completing) -- classified
 * INFRA_ERROR, never left RUNNING forever and never silently retried:
 * per the approved v1 scope, no automatic retry exists yet, so a
 * recovered row surfaces as a genuine, visible failure the user can act
 * on (request a new VerificationRun explicitly).
 */
export async function recoverStaleClaims(db: Database): Promise<number> {
  const now = new Date();
  const result = await db
    .update(schema.verificationRuns)
    .set({
      status: 'INFRA_ERROR',
      failureCategory: 'SANDBOX_INFRA_FAILURE',
      failureReason: 'worker lease expired before the run completed (worker crash or restart)',
      completedAt: now,
    })
    .where(
      and(
        eq(schema.verificationRuns.status, 'RUNNING'),
        or(
          isNull(schema.verificationRuns.leaseExpiresAt),
          lt(schema.verificationRuns.leaseExpiresAt, now),
        ),
      ),
    )
    .returning({ id: schema.verificationRuns.id });

  return result.length;
}

/** Extends this worker's lease on a still-in-progress run -- called periodically during a long-running verification so a slow-but-alive worker isn't mistaken for a crashed one. */
export async function renewLease(db: Database, verificationRunId: string): Promise<void> {
  await db
    .update(schema.verificationRuns)
    .set({ leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS) })
    .where(eq(schema.verificationRuns.id, verificationRunId));
}
