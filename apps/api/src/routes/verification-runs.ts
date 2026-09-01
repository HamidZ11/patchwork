import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import { getPatchAttemptForUser } from '../remediation/persistence.js';
import { requireAuth } from '../plugins/session.js';

export interface VerificationRunsRoutesDeps {
  db: Database;
}

/**
 * Trusted-layer half of sandbox verification: authenticates, ownership-
 * scopes the PatchAttempt, verifies it's actually GENERATED (nothing
 * else is meaningful to verify), and enqueues the work by inserting a
 * PENDING verification_runs row -- apps/worker's poll loop (see
 * apps/worker/src/verification/) picks it up, acquires the exact
 * snapshot, creates the sandbox, and runs the actual verification. This
 * route never touches a sandbox, never downloads an archive, and never
 * sees a GitHub token -- it only authorizes and enqueues, matching the
 * same synchronous-and-fast API / heavier-async-worker split described
 * in docs/verification.md.
 */
export function registerVerificationRunsRoutes(
  app: FastifyInstance,
  deps: VerificationRunsRoutesDeps,
): void {
  app.post<{ Params: { id: string } }>(
    '/patch-attempts/:id/verification-runs',
    { preHandler: requireAuth },
    async (request, reply) => {
      const patchAttempt = await getPatchAttemptForUser(
        deps.db,
        request.user!.id,
        request.params.id,
      );
      if (!patchAttempt) {
        return reply.status(404).send({ error: 'Not Found', message: 'Patch attempt not found.' });
      }
      if (patchAttempt.status !== 'GENERATED') {
        return reply.status(409).send({
          error: 'Conflict',
          message: `Patch attempt status is ${patchAttempt.status}, not GENERATED -- nothing to verify.`,
        });
      }

      const [inFlight] = await deps.db
        .select({ id: schema.verificationRuns.id })
        .from(schema.verificationRuns)
        .where(
          and(
            eq(schema.verificationRuns.patchAttemptId, patchAttempt.id),
            inArray(schema.verificationRuns.status, ['PENDING', 'RUNNING']),
          ),
        )
        .limit(1);
      if (inFlight) {
        return reply.status(200).send({ verificationRun: inFlight, alreadyInFlight: true });
      }

      const [run] = await deps.db
        .insert(schema.verificationRuns)
        .values({ patchAttemptId: patchAttempt.id, status: 'PENDING' })
        .returning({
          id: schema.verificationRuns.id,
          status: schema.verificationRuns.status,
          createdAt: schema.verificationRuns.createdAt,
        });
      if (!run) throw new Error('failed to create verification run');

      return reply.status(201).send({ verificationRun: run });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/verification-runs/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const [row] = await deps.db
        .select({
          id: schema.verificationRuns.id,
          patchAttemptId: schema.verificationRuns.patchAttemptId,
          status: schema.verificationRuns.status,
          failureCategory: schema.verificationRuns.failureCategory,
          failureReason: schema.verificationRuns.failureReason,
          manifest: schema.verificationRuns.manifest,
          sandboxProvider: schema.verificationRuns.sandboxProvider,
          sandboxRuntime: schema.verificationRuns.sandboxRuntime,
          nodeVersion: schema.verificationRuns.nodeVersion,
          nodeVersionSource: schema.verificationRuns.nodeVersionSource,
          packageManager: schema.verificationRuns.packageManager,
          resultSummary: schema.verificationRuns.resultSummary,
          createdAt: schema.verificationRuns.createdAt,
          startedAt: schema.verificationRuns.startedAt,
          completedAt: schema.verificationRuns.completedAt,
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
            eq(schema.verificationRuns.id, request.params.id),
            eq(schema.githubInstallations.connectedByUserId, request.user!.id),
          ),
        )
        .limit(1);

      if (!row) {
        return reply
          .status(404)
          .send({ error: 'Not Found', message: 'Verification run not found.' });
      }

      const steps = await deps.db
        .select()
        .from(schema.verificationSteps)
        .where(eq(schema.verificationSteps.verificationRunId, row.id))
        .orderBy(schema.verificationSteps.sequence);

      return reply.send({ verificationRun: { ...row, steps } });
    },
  );
}
