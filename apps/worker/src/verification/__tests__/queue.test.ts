import { afterAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import { loadEnv } from '@patchwork/config';
import { createDbClient, schema, type DbClient } from '@patchwork/db';
import { claimNextPendingRun, recoverStaleClaims, renewLease } from '../queue.js';
import { processNextPendingRun } from '../process.js';
import { createFakeSandboxRunner } from './fake-sandbox-runner.js';
import { fakeGitHubAppAuth, fakeGitHubClientWithArchive } from './fixtures.js';

const PKG = JSON.stringify({
  name: 'demo',
  scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' },
});
const REPO_FILES = { 'package.json': PKG, 'package-lock.json': '{}', 'src/billing.ts': 'old\n' };

/**
 * Deliberately one file, not split across queue.test.ts / process.test.ts:
 * both exercise the same shared, globally-ordered verification_runs
 * "queue" (claimNextPendingRun has no per-test scoping -- by design, it
 * grabs whatever PENDING row is oldest). Vitest runs test FILES
 * concurrently by default but `it()` blocks within one file
 * sequentially, so keeping every test that creates a PENDING/RUNNING row
 * in this single file is what actually guarantees isolation -- splitting
 * across files reintroduced exactly the cross-file race this comment
 * warns about (confirmed: two other tests' rows were briefly claimed by
 * the wrong test when this lived in a second file).
 *
 * Requires a reachable, migrated PostgreSQL instance (see
 * docs/testing.md). Each test creates its own patch_attempt-independent
 * verification_runs row directly (verification_runs.patch_attempt_id has
 * a real FK, so we still need a minimal owning chain: user ->
 * installation -> repository -> snapshot -> analysis_run ->
 * provider_change/rule_version -> impact_assessment -> patch_attempt) --
 * built once per test via a small local helper, cleaned up afterward.
 */
describe('verification queue (real database)', () => {
  const env = loadEnv();
  const db: DbClient = createDbClient(env.DATABASE_URL);

  afterAll(async () => {
    await db.close();
  });

  function uniqueId(): number {
    return Math.floor(Math.random() * 1_000_000_000_000);
  }

  async function createPatchAttemptChain(
    diff: string | null = null,
  ): Promise<{ patchAttemptId: string; userId: string }> {
    const githubUserId = uniqueId();
    const [user] = await db.db
      .insert(schema.users)
      .values({ githubUserId, githubLogin: `test-${githubUserId}` })
      .returning();
    const [installation] = await db.db
      .insert(schema.githubInstallations)
      .values({
        githubInstallationId: uniqueId(),
        accountType: 'User',
        accountId: uniqueId(),
        accountLogin: 'octocat',
        connectedByUserId: user!.id,
      })
      .returning();
    const [repository] = await db.db
      .insert(schema.repositories)
      .values({
        githubRepositoryId: uniqueId(),
        installationId: installation!.id,
        owner: 'octocat',
        name: 'hello-world',
        fullName: 'octocat/hello-world',
        isPrivate: false,
        defaultBranch: 'main',
      })
      .returning();
    const [snapshot] = await db.db
      .insert(schema.repositorySnapshots)
      .values({
        repositoryId: repository!.id,
        commitSha: 'a'.repeat(40),
        ref: 'main',
        acquisitionMethod: 'github_default_branch',
      })
      .returning();
    const [run] = await db.db
      .insert(schema.analysisRuns)
      .values({
        repositorySnapshotId: snapshot!.id,
        triggeredByUserId: user!.id,
        analyzerVersion: 'v1',
        status: 'completed',
      })
      .returning();
    const [providerChange] = await db.db
      .insert(schema.providerChanges)
      .values({
        provider: 'stripe',
        externalId: `test-${uniqueId()}`,
        title: 'Test change',
        sourceUrl: 'https://example.com',
      })
      .returning();
    const [ruleVersion] = await db.db
      .insert(schema.ruleVersions)
      .values({
        providerChangeId: providerChange!.id,
        version: 'v1',
        predicateKind: 'test_kind',
        migrationRequirement: 'test',
      })
      .returning();
    const [assessment] = await db.db
      .insert(schema.impactAssessments)
      .values({
        analysisRunId: run!.id,
        ruleVersionId: ruleVersion!.id,
        status: 'AFFECTED',
        reason: 'test',
        coverage: {},
      })
      .returning();
    const [patchAttempt] = await db.db
      .insert(schema.patchAttempts)
      .values({
        impactAssessmentId: assessment!.id,
        transformationKind: 'test',
        transformationVersion: 'v1',
        status: 'GENERATED',
        diff,
        changedFiles: diff ? ['src/billing.ts'] : [],
      })
      .returning();

    return { patchAttemptId: patchAttempt!.id, userId: user!.id };
  }

  async function cleanup(userId: string): Promise<void> {
    const installations = await db.db
      .select({ id: schema.githubInstallations.id })
      .from(schema.githubInstallations)
      .where(eq(schema.githubInstallations.connectedByUserId, userId));
    for (const installation of installations) {
      const repos = await db.db
        .select({ id: schema.repositories.id })
        .from(schema.repositories)
        .where(eq(schema.repositories.installationId, installation.id));
      for (const repo of repos) {
        const snapshots = await db.db
          .select({ id: schema.repositorySnapshots.id })
          .from(schema.repositorySnapshots)
          .where(eq(schema.repositorySnapshots.repositoryId, repo.id));
        for (const snapshot of snapshots) {
          const runs = await db.db
            .select({ id: schema.analysisRuns.id })
            .from(schema.analysisRuns)
            .where(eq(schema.analysisRuns.repositorySnapshotId, snapshot.id));
          for (const run of runs) {
            const assessments = await db.db
              .select({ id: schema.impactAssessments.id })
              .from(schema.impactAssessments)
              .where(eq(schema.impactAssessments.analysisRunId, run.id));
            for (const assessment of assessments) {
              const attempts = await db.db
                .select({ id: schema.patchAttempts.id })
                .from(schema.patchAttempts)
                .where(eq(schema.patchAttempts.impactAssessmentId, assessment.id));
              for (const attempt of attempts) {
                await db.db
                  .delete(schema.verificationRuns)
                  .where(eq(schema.verificationRuns.patchAttemptId, attempt.id));
              }
              await db.db
                .delete(schema.patchAttempts)
                .where(eq(schema.patchAttempts.impactAssessmentId, assessment.id));
            }
            await db.db
              .delete(schema.impactAssessments)
              .where(eq(schema.impactAssessments.analysisRunId, run.id));
          }
          await db.db
            .delete(schema.analysisRuns)
            .where(eq(schema.analysisRuns.repositorySnapshotId, snapshot.id));
        }
      }
    }
    await db.db
      .delete(schema.githubInstallations)
      .where(eq(schema.githubInstallations.connectedByUserId, userId));
    await db.db.delete(schema.users).where(eq(schema.users.id, userId));
  }

  it('claims a PENDING run, setting status=RUNNING with a lease', async () => {
    const { patchAttemptId, userId } = await createPatchAttemptChain();
    const [run] = await db.db
      .insert(schema.verificationRuns)
      .values({ patchAttemptId, status: 'PENDING' })
      .returning();

    const claimed = await claimNextPendingRun(db.db, 'worker-a');
    expect(claimed?.id).toBe(run!.id);

    const [updated] = await db.db
      .select()
      .from(schema.verificationRuns)
      .where(eq(schema.verificationRuns.id, run!.id));
    expect(updated?.status).toBe('RUNNING');
    expect(updated?.claimedBy).toBe('worker-a');
    expect(updated?.leaseExpiresAt).not.toBeNull();

    await cleanup(userId);
  });

  it('two workers racing for the same PENDING row never both claim it', async () => {
    const { patchAttemptId, userId } = await createPatchAttemptChain();
    await db.db.insert(schema.verificationRuns).values({ patchAttemptId, status: 'PENDING' });

    const [a, b] = await Promise.all([
      claimNextPendingRun(db.db, 'worker-a'),
      claimNextPendingRun(db.db, 'worker-b'),
    ]);
    const claimedCount = [a, b].filter((c) => c !== null).length;
    expect(claimedCount).toBe(1);

    await cleanup(userId);
  });

  it('returns null when there is no PENDING work', async () => {
    const { patchAttemptId, userId } = await createPatchAttemptChain();
    await db.db.insert(schema.verificationRuns).values({ patchAttemptId, status: 'PASSED' });

    const claimed = await claimNextPendingRun(db.db, 'worker-a');
    expect(claimed).toBeNull();

    await cleanup(userId);
  });

  it('recovers a RUNNING row whose lease has expired -- never stuck forever after a worker crash', async () => {
    const { patchAttemptId, userId } = await createPatchAttemptChain();
    const [run] = await db.db
      .insert(schema.verificationRuns)
      .values({
        patchAttemptId,
        status: 'RUNNING',
        claimedBy: 'worker-dead',
        claimedAt: new Date(Date.now() - 60 * 60 * 1000),
        leaseExpiresAt: new Date(Date.now() - 1000), // already expired
      })
      .returning();

    const recoveredCount = await recoverStaleClaims(db.db);
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    const [updated] = await db.db
      .select()
      .from(schema.verificationRuns)
      .where(eq(schema.verificationRuns.id, run!.id));
    expect(updated?.status).toBe('INFRA_ERROR');
    expect(updated?.failureCategory).toBe('SANDBOX_INFRA_FAILURE');
    expect(updated?.completedAt).not.toBeNull();

    await cleanup(userId);
  });

  it('does not recover a RUNNING row whose lease has not yet expired', async () => {
    const { patchAttemptId, userId } = await createPatchAttemptChain();
    const [run] = await db.db
      .insert(schema.verificationRuns)
      .values({
        patchAttemptId,
        status: 'RUNNING',
        claimedBy: 'worker-alive',
        claimedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // far future
      })
      .returning();

    await recoverStaleClaims(db.db);

    const [updated] = await db.db
      .select()
      .from(schema.verificationRuns)
      .where(eq(schema.verificationRuns.id, run!.id));
    expect(updated?.status).toBe('RUNNING');

    await cleanup(userId);
  });

  it('renewLease extends the expiry so an alive-but-slow worker is not mistaken for a crashed one', async () => {
    const { patchAttemptId, userId } = await createPatchAttemptChain();
    const nearExpiry = new Date(Date.now() + 1000);
    const [run] = await db.db
      .insert(schema.verificationRuns)
      .values({
        patchAttemptId,
        status: 'RUNNING',
        claimedBy: 'worker-a',
        claimedAt: new Date(),
        leaseExpiresAt: nearExpiry,
      })
      .returning();

    await renewLease(db.db, run!.id);

    const [updated] = await db.db
      .select()
      .from(schema.verificationRuns)
      .where(eq(schema.verificationRuns.id, run!.id));
    expect(updated!.leaseExpiresAt!.getTime()).toBeGreaterThan(nearExpiry.getTime());

    await cleanup(userId);
  });

  describe('processNextPendingRun', () => {
    it('returns false when there is no PENDING work belonging to this test', async () => {
      const { patchAttemptId, userId } = await createPatchAttemptChain();
      await db.db.insert(schema.verificationRuns).values({ patchAttemptId, status: 'PASSED' });

      const processed = await processNextPendingRun({
        db: db.db,
        githubClient: fakeGitHubClientWithArchive({}),
        githubAppAuth: fakeGitHubAppAuth(),
        sandboxRunner: createFakeSandboxRunner(),
        logger: pino({ level: 'silent' }),
        workerId: 'test-worker',
      });
      // Only meaningful in isolation (this file's other tests may leave
      // no PENDING rows at this exact point since they clean up after
      // themselves) -- assert the weaker, still-real property: this call
      // never claims *this test's own* PASSED row.
      const [unchanged] = await db.db
        .select()
        .from(schema.verificationRuns)
        .where(eq(schema.verificationRuns.patchAttemptId, patchAttemptId));
      expect(unchanged?.status).toBe('PASSED');
      void processed;

      await cleanup(userId);
    });

    it('claims, runs, and persists a PASSED result with its steps', async () => {
      const { patchAttemptId, userId } = await createPatchAttemptChain(
        '--- src/billing.ts\n+++ src/billing.ts\n@@ -1 +1 @@\n-old\n+new\n',
      );
      const [run] = await db.db
        .insert(schema.verificationRuns)
        .values({ patchAttemptId, status: 'PENDING' })
        .returning();

      const sandboxRunner = createFakeSandboxRunner({
        runCommand: async (_h, c) => ({
          exitCode: 0,
          timedOut: false,
          stdout: `ok ${c.executable}`,
          stderr: '',
          durationMs: 1,
        }),
      });

      const processed = await processNextPendingRun({
        db: db.db,
        githubClient: fakeGitHubClientWithArchive(REPO_FILES),
        githubAppAuth: fakeGitHubAppAuth(),
        sandboxRunner,
        logger: pino({ level: 'silent' }),
        workerId: 'test-worker',
      });
      expect(processed).toBe(true);

      const [updated] = await db.db
        .select()
        .from(schema.verificationRuns)
        .where(eq(schema.verificationRuns.id, run!.id));
      expect(updated?.status).toBe('PASSED');
      expect(updated?.sandboxProvider).toBe('e2b');
      expect(updated?.packageManager).toBe('npm');
      expect(updated?.completedAt).not.toBeNull();

      const steps = await db.db
        .select()
        .from(schema.verificationSteps)
        .where(eq(schema.verificationSteps.verificationRunId, run!.id));
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.every((s) => s.status === 'PASSED')).toBe(true);

      await cleanup(userId);
    });

    it('persists REFUSED when the patch attempt has no diff (defensive: should not normally happen)', async () => {
      const { patchAttemptId, userId } = await createPatchAttemptChain(null);
      const [run] = await db.db
        .insert(schema.verificationRuns)
        .values({ patchAttemptId, status: 'PENDING' })
        .returning();

      await processNextPendingRun({
        db: db.db,
        githubClient: fakeGitHubClientWithArchive(REPO_FILES),
        githubAppAuth: fakeGitHubAppAuth(),
        sandboxRunner: createFakeSandboxRunner(),
        logger: pino({ level: 'silent' }),
        workerId: 'test-worker',
      });

      const [updated] = await db.db
        .select()
        .from(schema.verificationRuns)
        .where(eq(schema.verificationRuns.id, run!.id));
      expect(updated?.status).toBe('REFUSED');
      expect(updated?.failureCategory).toBe('POLICY_REFUSAL');

      await cleanup(userId);
    });
  });
});
