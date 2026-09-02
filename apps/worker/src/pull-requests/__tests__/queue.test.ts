import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createTwoFilesPatch } from 'diff';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import { loadEnv } from '@patchwork/config';
import { createDbClient, schema, type DbClient } from '@patchwork/db';
import { fakeGitHubAppAuth } from '../../__tests__/fixtures.js';
import { processNextPendingPullRequestAttempt } from '../process.js';
import {
  claimNextPendingPullRequestAttempt,
  recoverStalePullRequestClaims,
  renewPullRequestLease,
} from '../queue.js';
import { createFakeGitHubRepo } from './fake-github-repo.js';

const ANALYSED_SHA = 'a'.repeat(40);
const BEFORE = 'export function f(invoice: any) {\n  return invoice.subscription;\n}\n';
const AFTER =
  'export function f(invoice: any) {\n  return (invoice.parent?.subscription_details?.subscription ?? null);\n}\n';
const DIFF = createTwoFilesPatch(
  'src/billing.ts',
  'src/billing.ts',
  BEFORE,
  AFTER,
  undefined,
  undefined,
  {
    context: 3,
  },
);
const DIFF_SHA256 = createHash('sha256').update(DIFF).digest('hex');

/**
 * Deliberately one file, not split across queue.test.ts/process.test.ts --
 * same reasoning as verification/__tests__/queue.test.ts's own doc
 * comment: claimNextPendingPullRequestAttempt has no per-test scoping (it
 * grabs the oldest PENDING row across the whole table by design), so
 * every test that creates a PENDING/RUNNING pull_request_attempts row
 * must live in this one file to avoid a cross-file claim race.
 */
describe('pull request attempt queue (real database)', () => {
  const env = loadEnv();
  const db: DbClient = createDbClient(env.DATABASE_URL);

  afterAll(async () => {
    await db.close();
  });

  function uniqueId(): number {
    return Math.floor(Math.random() * 1_000_000_000_000);
  }

  async function createVerificationRunChain(
    options: { diff?: string | null; verificationStatus?: string; diffSha256?: string | null } = {},
  ): Promise<{ patchAttemptId: string; verificationRunId: string; userId: string }> {
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
        commitSha: ANALYSED_SHA,
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
        title: 'Removes Invoice.subscription',
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
    const diff = options.diff === undefined ? DIFF : options.diff;
    const [patchAttempt] = await db.db
      .insert(schema.patchAttempts)
      .values({
        impactAssessmentId: assessment!.id,
        transformationKind: 'stripe_invoice_subscription_to_parent',
        transformationVersion: 'v1',
        status: 'GENERATED',
        diff,
        changedFiles: diff ? ['src/billing.ts'] : [],
      })
      .returning();
    const diffSha256 = options.diffSha256 === undefined ? DIFF_SHA256 : options.diffSha256;
    const [verificationRun] = await db.db
      .insert(schema.verificationRuns)
      .values({
        patchAttemptId: patchAttempt!.id,
        status: options.verificationStatus ?? 'PASSED',
        manifestVersion: '1',
        manifest: diffSha256
          ? { version: 1, patch: { patchAttemptId: patchAttempt!.id, diffSha256 } }
          : null,
        sandboxProvider: 'e2b',
        nodeVersion: '20',
        nodeVersionSource: 'patchwork_default',
        packageManager: 'npm',
      })
      .returning();

    return {
      patchAttemptId: patchAttempt!.id,
      verificationRunId: verificationRun!.id,
      userId: user!.id,
    };
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
                  .delete(schema.pullRequestAttempts)
                  .where(eq(schema.pullRequestAttempts.patchAttemptId, attempt.id));
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

  it('claims a PENDING pull request attempt, setting status=RUNNING with a lease', async () => {
    const { patchAttemptId, verificationRunId, userId } = await createVerificationRunChain();
    const [attempt] = await db.db
      .insert(schema.pullRequestAttempts)
      .values({ patchAttemptId, verificationRunId, status: 'PENDING' })
      .returning();

    const claimed = await claimNextPendingPullRequestAttempt(db.db, 'worker-a');
    expect(claimed?.id).toBe(attempt!.id);

    const [updated] = await db.db
      .select()
      .from(schema.pullRequestAttempts)
      .where(eq(schema.pullRequestAttempts.id, attempt!.id));
    expect(updated?.status).toBe('RUNNING');
    expect(updated?.claimedBy).toBe('worker-a');
    expect(updated?.leaseExpiresAt).not.toBeNull();

    await cleanup(userId);
  });

  it('two workers racing for the same PENDING row never both claim it', async () => {
    const { patchAttemptId, verificationRunId, userId } = await createVerificationRunChain();
    await db.db
      .insert(schema.pullRequestAttempts)
      .values({ patchAttemptId, verificationRunId, status: 'PENDING' });

    const [a, b] = await Promise.all([
      claimNextPendingPullRequestAttempt(db.db, 'worker-a'),
      claimNextPendingPullRequestAttempt(db.db, 'worker-b'),
    ]);
    expect([a, b].filter((c) => c !== null).length).toBe(1);

    await cleanup(userId);
  });

  it('recovers a RUNNING row whose lease has expired -- never stuck forever after a worker crash', async () => {
    const { patchAttemptId, verificationRunId, userId } = await createVerificationRunChain();
    const [attempt] = await db.db
      .insert(schema.pullRequestAttempts)
      .values({
        patchAttemptId,
        verificationRunId,
        status: 'RUNNING',
        claimedBy: 'worker-dead',
        claimedAt: new Date(Date.now() - 60 * 60 * 1000),
        leaseExpiresAt: new Date(Date.now() - 1000),
      })
      .returning();

    const recoveredCount = await recoverStalePullRequestClaims(db.db);
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    const [updated] = await db.db
      .select()
      .from(schema.pullRequestAttempts)
      .where(eq(schema.pullRequestAttempts.id, attempt!.id));
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failureCategory).toBe('GITHUB_API_FAILURE');
    expect(updated?.completedAt).not.toBeNull();

    await cleanup(userId);
  });

  it('does not recover a RUNNING row whose lease has not yet expired', async () => {
    const { patchAttemptId, verificationRunId, userId } = await createVerificationRunChain();
    const [attempt] = await db.db
      .insert(schema.pullRequestAttempts)
      .values({
        patchAttemptId,
        verificationRunId,
        status: 'RUNNING',
        claimedBy: 'worker-alive',
        claimedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning();

    await recoverStalePullRequestClaims(db.db);

    const [updated] = await db.db
      .select()
      .from(schema.pullRequestAttempts)
      .where(eq(schema.pullRequestAttempts.id, attempt!.id));
    expect(updated?.status).toBe('RUNNING');

    await cleanup(userId);
  });

  it('renewPullRequestLease extends the expiry', async () => {
    const { patchAttemptId, verificationRunId, userId } = await createVerificationRunChain();
    const nearExpiry = new Date(Date.now() + 1000);
    const [attempt] = await db.db
      .insert(schema.pullRequestAttempts)
      .values({
        patchAttemptId,
        verificationRunId,
        status: 'RUNNING',
        claimedBy: 'worker-a',
        claimedAt: new Date(),
        leaseExpiresAt: nearExpiry,
      })
      .returning();

    await renewPullRequestLease(db.db, attempt!.id);

    const [updated] = await db.db
      .select()
      .from(schema.pullRequestAttempts)
      .where(eq(schema.pullRequestAttempts.id, attempt!.id));
    expect(updated!.leaseExpiresAt!.getTime()).toBeGreaterThan(nearExpiry.getTime());

    await cleanup(userId);
  });

  describe('processNextPendingPullRequestAttempt', () => {
    it('claims, publishes, and persists an OPENED result with branch/commit/PR fields', async () => {
      const { patchAttemptId, verificationRunId, userId } = await createVerificationRunChain();
      const [attempt] = await db.db
        .insert(schema.pullRequestAttempts)
        .values({ patchAttemptId, verificationRunId, status: 'PENDING' })
        .returning();

      const repo = createFakeGitHubRepo({
        defaultBranch: 'main',
        defaultBranchSha: ANALYSED_SHA,
        files: { 'src/billing.ts': BEFORE },
      });

      const processed = await processNextPendingPullRequestAttempt({
        db: db.db,
        githubClient: repo.client,
        githubAppAuth: fakeGitHubAppAuth(),
        appSlug: 'patchwork-dev',
        logger: pino({ level: 'silent' }),
        workerId: 'test-worker',
      });
      expect(processed).toBe(true);

      const [updated] = await db.db
        .select()
        .from(schema.pullRequestAttempts)
        .where(eq(schema.pullRequestAttempts.id, attempt!.id));
      expect(updated?.status).toBe('OPENED');
      expect(updated?.branchName).toBe(
        'patchwork/stripe-invoice-subscription-to-parent/' +
          patchAttemptId.replace(/-/g, '').slice(0, 8),
      );
      expect(updated?.commitSha).toBeTruthy();
      expect(updated?.githubPrNumber).toBe(1);
      expect(updated?.githubPrUrl).toContain('/pull/1');

      await cleanup(userId);
    });

    it('persists REFUSED/STALE_BASE when the default branch has moved', async () => {
      const { patchAttemptId, verificationRunId, userId } = await createVerificationRunChain();
      const [attempt] = await db.db
        .insert(schema.pullRequestAttempts)
        .values({ patchAttemptId, verificationRunId, status: 'PENDING' })
        .returning();

      const repo = createFakeGitHubRepo({
        defaultBranch: 'main',
        defaultBranchSha: ANALYSED_SHA,
        files: { 'src/billing.ts': BEFORE },
      });
      repo.advanceDefaultBranch('f'.repeat(40));

      await processNextPendingPullRequestAttempt({
        db: db.db,
        githubClient: repo.client,
        githubAppAuth: fakeGitHubAppAuth(),
        appSlug: 'patchwork-dev',
        logger: pino({ level: 'silent' }),
        workerId: 'test-worker',
      });

      const [updated] = await db.db
        .select()
        .from(schema.pullRequestAttempts)
        .where(eq(schema.pullRequestAttempts.id, attempt!.id));
      expect(updated?.status).toBe('REFUSED');
      expect(updated?.failureCategory).toBe('STALE_BASE');

      await cleanup(userId);
    });

    it('a second attempt for the same patch attempt resumes from the first attempt’s branch/commit rather than duplicating', async () => {
      const { patchAttemptId, verificationRunId, userId } = await createVerificationRunChain();
      const repo = createFakeGitHubRepo({
        defaultBranch: 'main',
        defaultBranchSha: ANALYSED_SHA,
        files: { 'src/billing.ts': BEFORE },
      });

      const [firstAttempt] = await db.db
        .insert(schema.pullRequestAttempts)
        .values({ patchAttemptId, verificationRunId, status: 'PENDING' })
        .returning();
      await processNextPendingPullRequestAttempt({
        db: db.db,
        githubClient: repo.client,
        githubAppAuth: fakeGitHubAppAuth(),
        appSlug: 'patchwork-dev',
        logger: pino({ level: 'silent' }),
        workerId: 'test-worker',
      });
      const [completedFirst] = await db.db
        .select()
        .from(schema.pullRequestAttempts)
        .where(eq(schema.pullRequestAttempts.id, firstAttempt!.id));
      expect(completedFirst?.status).toBe('OPENED');

      const [secondAttempt] = await db.db
        .insert(schema.pullRequestAttempts)
        .values({ patchAttemptId, verificationRunId, status: 'PENDING' })
        .returning();
      await processNextPendingPullRequestAttempt({
        db: db.db,
        githubClient: repo.client,
        githubAppAuth: fakeGitHubAppAuth(),
        appSlug: 'patchwork-dev',
        logger: pino({ level: 'silent' }),
        workerId: 'test-worker',
      });
      const [completedSecond] = await db.db
        .select()
        .from(schema.pullRequestAttempts)
        .where(eq(schema.pullRequestAttempts.id, secondAttempt!.id));

      expect(completedSecond?.status).toBe('OPENED');
      expect(completedSecond?.commitSha).toBe(completedFirst?.commitSha);
      expect(completedSecond?.githubPrNumber).toBe(completedFirst?.githubPrNumber);
      expect(repo.prs).toHaveLength(1);

      await cleanup(userId);
    });
  });
});
