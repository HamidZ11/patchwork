import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { loadEnv } from '@patchwork/config';
import { createDbClient, schema, type DbClient } from '@patchwork/db';
import { buildApp } from '../app.js';
import { createSession } from '../auth/sessions.js';
import { findOrCreateUserByGitHubProfile } from '../auth/users.js';
import type { GitHubInstallationInfo, GitHubRepository } from '@patchwork/github';
import { upsertInstallationAndRepositories } from '../github/persistence.js';
import { STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE } from '../analysis/impact/rules/stripe-basil-invoice-subscription.js';
import {
  fakeGitHubAppAuth,
  fakeGitHubClientWithArchive,
  testAppDeps,
  uniqueGithubId,
} from './fixtures.js';

const STRIPE_IMPORT = "import Stripe from 'stripe';";

function affectedFixtureFiles(): Record<string, string> {
  return {
    'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
    'package-lock.json': JSON.stringify({
      packages: { '': {}, 'node_modules/stripe': { version: '18.2.0' } },
    }),
    'src/billing.ts': [
      STRIPE_IMPORT,
      "const stripe = new Stripe('sk_test');",
      'async function run(id: string) {',
      '  const invoice = await stripe.invoices.retrieve(id);',
      '  return invoice.subscription;',
      '}',
    ].join('\n'),
  };
}

// Requires a reachable, migrated PostgreSQL instance (see docs/testing.md).
describe('pull request attempts (real database)', () => {
  const env = loadEnv();
  const db: DbClient = createDbClient(env.DATABASE_URL);

  afterAll(async () => {
    await db.close();
  });

  async function createAuthenticatedUser(): Promise<{ cookie: string; userId: string }> {
    const githubUserId = uniqueGithubId();
    const user = await findOrCreateUserByGitHubProfile(db.db, {
      id: githubUserId,
      login: `test-user-${githubUserId}`,
      avatarUrl: null,
    });
    const { token } = await createSession(db.db, user.id);
    return { cookie: `patchwork_session=${token}`, userId: user.id };
  }

  async function cleanupUser(userId: string): Promise<void> {
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

  async function connectRepository(userId: string): Promise<{ repositoryId: string }> {
    const installationId = uniqueGithubId();
    const installation: GitHubInstallationInfo = {
      id: installationId,
      accountType: 'User',
      accountId: uniqueGithubId(),
      accountLogin: 'octocat',
    };
    const repository: GitHubRepository = {
      id: uniqueGithubId(),
      owner: 'octocat',
      name: 'hello-world',
      fullName: 'octocat/hello-world',
      isPrivate: false,
      defaultBranch: 'main',
    };

    await upsertInstallationAndRepositories(db.db, {
      installation,
      repositories: [repository],
      connectedByUserId: userId,
    });

    const [row] = await db.db
      .select({ id: schema.repositories.id })
      .from(schema.repositories)
      .where(eq(schema.repositories.githubRepositoryId, repository.id));
    if (!row) throw new Error('failed to set up test repository');
    return { repositoryId: row.id };
  }

  async function createGeneratedPatchAttempt(
    cookie: string,
    repositoryId: string,
  ): Promise<{
    app: ReturnType<typeof buildApp>;
    analysisRunId: string;
    assessmentId: string;
    patchAttemptId: string;
    diff: string;
    changedFiles: string[];
  }> {
    const githubClient = fakeGitHubClientWithArchive(affectedFixtureFiles(), {
      getBranchCommitSha: async () => 'a'.repeat(40),
    });
    const app = buildApp(testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth() }));

    const analyseResponse = await app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/analyses`,
      headers: { cookie },
    });
    const { analysisRun } = analyseResponse.json() as { analysisRun: { id: string } };

    await app.inject({
      method: 'POST',
      url: `/analysis-runs/${analysisRun.id}/impact-assessments`,
      headers: { cookie },
    });

    const [assessmentRow] = await db.db
      .select({ id: schema.impactAssessments.id })
      .from(schema.impactAssessments)
      .innerJoin(
        schema.ruleVersions,
        eq(schema.impactAssessments.ruleVersionId, schema.ruleVersions.id),
      )
      .innerJoin(
        schema.providerChanges,
        eq(schema.ruleVersions.providerChangeId, schema.providerChanges.id),
      )
      .where(
        and(
          eq(schema.impactAssessments.analysisRunId, analysisRun.id),
          eq(
            schema.providerChanges.externalId,
            STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE.providerChange.externalId,
          ),
        ),
      );
    if (!assessmentRow) throw new Error('assessment not found');

    const patchResponse = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessmentRow.id}/patch-attempts`,
      headers: { cookie },
    });
    const { patchAttempt } = patchResponse.json() as {
      patchAttempt: { id: string; status: string; diff: string; changedFiles: string[] };
    };
    if (patchAttempt.status !== 'GENERATED') {
      throw new Error(`expected GENERATED patch attempt, got ${patchAttempt.status}`);
    }

    return {
      app,
      analysisRunId: analysisRun.id,
      assessmentId: assessmentRow.id,
      patchAttemptId: patchAttempt.id,
      diff: patchAttempt.diff,
      changedFiles: patchAttempt.changedFiles,
    };
  }

  async function seedVerificationRun(
    patchAttemptId: string,
    overrides: Partial<typeof schema.verificationRuns.$inferInsert> = {},
  ): Promise<string> {
    const [row] = await db.db
      .insert(schema.verificationRuns)
      .values({ patchAttemptId, status: 'PASSED', ...overrides })
      .returning({ id: schema.verificationRuns.id });
    if (!row) throw new Error('failed to seed verification run');
    return row.id;
  }

  function manifestFor(patchAttemptId: string, diff: string) {
    return {
      version: 1,
      patch: { patchAttemptId, diffSha256: createHash('sha256').update(diff).digest('hex') },
    };
  }

  /**
   * Removes rows these tests insert directly. `pull_request_attempts
   * .verification_run_id` is ON DELETE RESTRICT, so a pull-request attempt
   * left in place blocks the cascade `cleanupUser` relies on and would leak
   * the whole lineage into the database.
   */
  async function cleanupSeededPublishRows(patchAttemptIds: string[]): Promise<void> {
    for (const patchAttemptId of patchAttemptIds) {
      await db.db
        .delete(schema.pullRequestAttempts)
        .where(eq(schema.pullRequestAttempts.patchAttemptId, patchAttemptId));
      await db.db
        .delete(schema.verificationRuns)
        .where(eq(schema.verificationRuns.patchAttemptId, patchAttemptId));
    }
  }

  it('returns 401 without a session', async () => {
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/verification-runs/${crypto.randomUUID()}/pull-requests`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for a verification run connected by a different user, without leaking its existence', async () => {
    const { cookie: ownerCookie, userId: ownerId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(ownerId);
    const { patchAttemptId, diff } = await createGeneratedPatchAttempt(ownerCookie, repositoryId);
    const verificationRunId = await seedVerificationRun(patchAttemptId, {
      manifest: manifestFor(patchAttemptId, diff),
    });

    const { cookie: otherCookie, userId: otherUserId } = await createAuthenticatedUser();
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/verification-runs/${verificationRunId}/pull-requests`,
      headers: { cookie: otherCookie },
    });

    expect(response.statusCode).toBe(404);
    await cleanupUser(otherUserId);
    await cleanupUser(ownerId);
  });

  it('returns 409 when the verification run is not PASSED', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { patchAttemptId, diff } = await createGeneratedPatchAttempt(cookie, repositoryId);
    const verificationRunId = await seedVerificationRun(patchAttemptId, {
      status: 'FAILED',
      manifest: manifestFor(patchAttemptId, diff),
    });

    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/verification-runs/${verificationRunId}/pull-requests`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
    await cleanupUser(userId);
  });

  it('returns 409 when the verified diff hash does not match the current patch attempt diff', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { patchAttemptId } = await createGeneratedPatchAttempt(cookie, repositoryId);
    const verificationRunId = await seedVerificationRun(patchAttemptId, {
      manifest: { version: 1, patch: { patchAttemptId, diffSha256: 'mismatched' } },
    });

    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/verification-runs/${verificationRunId}/pull-requests`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
    await cleanupUser(userId);
  });

  it('creates a PENDING pull request attempt for an eligible verification run', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { patchAttemptId, diff } = await createGeneratedPatchAttempt(cookie, repositoryId);
    const verificationRunId = await seedVerificationRun(patchAttemptId, {
      manifest: manifestFor(patchAttemptId, diff),
    });

    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/verification-runs/${verificationRunId}/pull-requests`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { pullRequestAttempt: { id: string; status: string } };
    expect(body.pullRequestAttempt.status).toBe('PENDING');

    const [persisted] = await db.db
      .select()
      .from(schema.pullRequestAttempts)
      .where(eq(schema.pullRequestAttempts.id, body.pullRequestAttempt.id));
    expect(persisted?.patchAttemptId).toBe(patchAttemptId);
    expect(persisted?.verificationRunId).toBe(verificationRunId);

    await cleanupUser(userId);
  });

  it('returns the existing in-flight attempt instead of creating a duplicate', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { patchAttemptId, diff } = await createGeneratedPatchAttempt(cookie, repositoryId);
    const verificationRunId = await seedVerificationRun(patchAttemptId, {
      manifest: manifestFor(patchAttemptId, diff),
    });

    const app = buildApp(testAppDeps({ db }));
    const first = await app.inject({
      method: 'POST',
      url: `/verification-runs/${verificationRunId}/pull-requests`,
      headers: { cookie },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/verification-runs/${verificationRunId}/pull-requests`,
      headers: { cookie },
    });

    const firstBody = first.json() as { pullRequestAttempt: { id: string } };
    const secondBody = second.json() as {
      pullRequestAttempt: { id: string };
      alreadyInFlight?: boolean;
    };
    expect(secondBody.pullRequestAttempt.id).toBe(firstBody.pullRequestAttempt.id);
    expect(secondBody.alreadyInFlight).toBe(true);

    const rows = await db.db
      .select()
      .from(schema.pullRequestAttempts)
      .where(eq(schema.pullRequestAttempts.patchAttemptId, patchAttemptId));
    expect(rows).toHaveLength(1);

    await cleanupUser(userId);
  });

  it('returns the existing OPENED attempt when the live PR is still open', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { patchAttemptId, diff } = await createGeneratedPatchAttempt(cookie, repositoryId);
    const verificationRunId = await seedVerificationRun(patchAttemptId, {
      manifest: manifestFor(patchAttemptId, diff),
    });
    await db.db.insert(schema.pullRequestAttempts).values({
      patchAttemptId,
      verificationRunId,
      status: 'OPENED',
      branchName: 'patchwork/x/abcd1234',
      commitSha: 'b'.repeat(40),
      githubPrNumber: 7,
      githubPrUrl: 'https://github.com/octocat/hello-world/pull/7',
    });

    const app = buildApp(
      testAppDeps({
        db,
        githubAppAuth: fakeGitHubAppAuth(),
        githubClient: fakeGitHubClientWithArchive(affectedFixtureFiles(), {
          getPullRequest: async () => ({
            number: 7,
            url: 'https://github.com/octocat/hello-world/pull/7',
            state: 'open',
            merged: false,
          }),
        }),
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: `/verification-runs/${verificationRunId}/pull-requests`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      pullRequestAttempt: { githubPrNumber: number };
      alreadyInFlight: boolean;
    };
    expect(body.pullRequestAttempt.githubPrNumber).toBe(7);
    expect(body.alreadyInFlight).toBe(true);

    const rows = await db.db
      .select()
      .from(schema.pullRequestAttempts)
      .where(eq(schema.pullRequestAttempts.patchAttemptId, patchAttemptId));
    expect(rows).toHaveLength(1); // no new attempt created

    await cleanupUser(userId);
  });

  it('returns 409 without creating a new attempt when the previous PR is closed', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { patchAttemptId, diff } = await createGeneratedPatchAttempt(cookie, repositoryId);
    const verificationRunId = await seedVerificationRun(patchAttemptId, {
      manifest: manifestFor(patchAttemptId, diff),
    });
    await db.db.insert(schema.pullRequestAttempts).values({
      patchAttemptId,
      verificationRunId,
      status: 'OPENED',
      branchName: 'patchwork/x/abcd1234',
      commitSha: 'b'.repeat(40),
      githubPrNumber: 9,
      githubPrUrl: 'https://github.com/octocat/hello-world/pull/9',
    });

    const app = buildApp(
      testAppDeps({
        db,
        githubAppAuth: fakeGitHubAppAuth(),
        githubClient: fakeGitHubClientWithArchive(affectedFixtureFiles(), {
          getPullRequest: async () => ({
            number: 9,
            url: 'https://github.com/octocat/hello-world/pull/9',
            state: 'closed',
            merged: false,
          }),
        }),
      }),
    );
    const response = await app.inject({
      method: 'POST',
      url: `/verification-runs/${verificationRunId}/pull-requests`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as { message: string };
    expect(body.message).toContain('#9');
    expect(body.message).toContain('no longer open');

    const rows = await db.db
      .select()
      .from(schema.pullRequestAttempts)
      .where(eq(schema.pullRequestAttempts.patchAttemptId, patchAttemptId));
    expect(rows).toHaveLength(1); // still just the original OPENED row -- nothing new created

    await cleanupUser(userId);
  });

  /**
   * Publication is deduplicated per ImpactAssessment, not per PatchAttempt.
   * Re-running "Prepare fix" appends a new PatchAttempt for the same change,
   * so a per-attempt guard alone would let Patchwork open a second pull
   * request for work it has already published -- the exact shape of the real
   * stripe-basil-fixture record, whose OPENED PR sits on a superseded attempt.
   */
  it('refuses to publish an assessment that already has an open pull request from an earlier patch attempt', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const {
      app,
      analysisRunId,
      assessmentId,
      patchAttemptId: earlierAttemptId,
      diff: earlierDiff,
    } = await createGeneratedPatchAttempt(cookie, repositoryId);

    const earlierVerificationRunId = await seedVerificationRun(earlierAttemptId, {
      manifest: manifestFor(earlierAttemptId, earlierDiff),
    });
    await db.db.insert(schema.pullRequestAttempts).values({
      patchAttemptId: earlierAttemptId,
      verificationRunId: earlierVerificationRunId,
      status: 'OPENED',
      branchName: 'patchwork/stripe-invoice-subscription-to-parent/aaaaaaaa',
      commitSha: 'c'.repeat(40),
      githubPrNumber: 4,
      githubPrUrl: 'https://github.com/octocat/hello-world/pull/4',
    });

    // "Prepare fix" again: a newer attempt for the same assessment, verified on
    // its own diff. Nothing about the earlier attempt blocks any of this.
    const laterPatchResponse = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessmentId}/patch-attempts`,
      headers: { cookie },
    });
    expect(laterPatchResponse.statusCode).toBe(201);
    const { patchAttempt: laterAttempt } = laterPatchResponse.json() as {
      patchAttempt: { id: string; status: string; diff: string };
    };
    expect(laterAttempt.id).not.toBe(earlierAttemptId);
    expect(laterAttempt.status).toBe('GENERATED');

    const laterVerificationRunId = await seedVerificationRun(laterAttempt.id, {
      manifest: manifestFor(laterAttempt.id, laterAttempt.diff),
    });

    const publishResponse = await app.inject({
      method: 'POST',
      url: `/verification-runs/${laterVerificationRunId}/pull-requests`,
      headers: { cookie },
    });

    expect(publishResponse.statusCode).toBe(409);
    const publishBody = publishResponse.json() as { message: string };
    expect(publishBody.message).toContain('#4');
    expect(publishBody.message).toContain('earlier patch attempt');

    // Refused, not enqueued: the later attempt has no pull request row at all.
    const laterPrRows = await db.db
      .select()
      .from(schema.pullRequestAttempts)
      .where(eq(schema.pullRequestAttempts.patchAttemptId, laterAttempt.id));
    expect(laterPrRows).toHaveLength(0);

    // The detail payload keeps both attempts' state strictly separate: the
    // OPENED pull request stays on the earlier attempt, and the current
    // (newest) attempt carries only its own verification run.
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/analysis-runs/${analysisRunId}`,
      headers: { cookie },
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = detailResponse.json() as {
      analysisRun: {
        assessments: {
          id: string;
          patchAttempts: {
            id: string;
            verificationRuns: { id: string }[];
            pullRequestAttempts: { status: string; githubPrNumber: number | null }[];
          }[];
        }[];
      };
    };
    const assessment = detail.analysisRun.assessments.find((a) => a.id === assessmentId);
    if (!assessment) throw new Error('assessment not found in analysis run detail');

    expect(assessment.patchAttempts[0]?.id).toBe(laterAttempt.id);
    expect(assessment.patchAttempts[0]?.pullRequestAttempts).toHaveLength(0);
    expect(assessment.patchAttempts[0]?.verificationRuns.map((run) => run.id)).toEqual([
      laterVerificationRunId,
    ]);

    const earlierInDetail = assessment.patchAttempts.find((a) => a.id === earlierAttemptId);
    expect(earlierInDetail?.pullRequestAttempts).toEqual([
      expect.objectContaining({ status: 'OPENED', githubPrNumber: 4 }),
    ]);
    expect(earlierInDetail?.verificationRuns.map((run) => run.id)).toEqual([
      earlierVerificationRunId,
    ]);

    await cleanupSeededPublishRows([earlierAttemptId, laterAttempt.id]);
    await cleanupUser(userId);
  });

  it('does not refuse a different assessment that has no pull request of its own', async () => {
    const { cookie, userId } = await createAuthenticatedUser();

    const published = await connectRepository(userId);
    const publishedFixture = await createGeneratedPatchAttempt(cookie, published.repositoryId);
    const publishedVerificationRunId = await seedVerificationRun(publishedFixture.patchAttemptId, {
      manifest: manifestFor(publishedFixture.patchAttemptId, publishedFixture.diff),
    });
    await db.db.insert(schema.pullRequestAttempts).values({
      patchAttemptId: publishedFixture.patchAttemptId,
      verificationRunId: publishedVerificationRunId,
      status: 'OPENED',
      branchName: 'patchwork/stripe-invoice-subscription-to-parent/bbbbbbbb',
      commitSha: 'd'.repeat(40),
      githubPrNumber: 5,
      githubPrUrl: 'https://github.com/octocat/hello-world/pull/5',
    });

    // A second repository, so a genuinely different ImpactAssessment.
    const other = await connectRepository(userId);
    const otherFixture = await createGeneratedPatchAttempt(cookie, other.repositoryId);
    expect(otherFixture.assessmentId).not.toBe(publishedFixture.assessmentId);
    const otherVerificationRunId = await seedVerificationRun(otherFixture.patchAttemptId, {
      manifest: manifestFor(otherFixture.patchAttemptId, otherFixture.diff),
    });

    const response = await otherFixture.app.inject({
      method: 'POST',
      url: `/verification-runs/${otherVerificationRunId}/pull-requests`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);

    await cleanupSeededPublishRows([publishedFixture.patchAttemptId, otherFixture.patchAttemptId]);
    await cleanupUser(userId);
  });

  it('GET /pull-request-attempts/:id returns 404 for another user, and the detail for the owner', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { patchAttemptId, diff } = await createGeneratedPatchAttempt(cookie, repositoryId);
    const verificationRunId = await seedVerificationRun(patchAttemptId, {
      manifest: manifestFor(patchAttemptId, diff),
    });

    const app = buildApp(testAppDeps({ db }));
    const createResponse = await app.inject({
      method: 'POST',
      url: `/verification-runs/${verificationRunId}/pull-requests`,
      headers: { cookie },
    });
    const { pullRequestAttempt } = createResponse.json() as { pullRequestAttempt: { id: string } };

    const ownerResponse = await app.inject({
      method: 'GET',
      url: `/pull-request-attempts/${pullRequestAttempt.id}`,
      headers: { cookie },
    });
    expect(ownerResponse.statusCode).toBe(200);
    const ownerBody = ownerResponse.json() as { pullRequestAttempt: { status: string } };
    expect(ownerBody.pullRequestAttempt.status).toBe('PENDING');

    const { cookie: otherCookie, userId: otherUserId } = await createAuthenticatedUser();
    const otherResponse = await app.inject({
      method: 'GET',
      url: `/pull-request-attempts/${pullRequestAttempt.id}`,
      headers: { cookie: otherCookie },
    });
    expect(otherResponse.statusCode).toBe(404);

    await cleanupUser(otherUserId);
    await cleanupUser(userId);
  });

  it('GET /analysis-runs/:id includes the pull request attempt for its patch attempt', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, patchAttemptId, diff } = await createGeneratedPatchAttempt(cookie, repositoryId);
    const verificationRunId = await seedVerificationRun(patchAttemptId, {
      manifest: manifestFor(patchAttemptId, diff),
    });

    const createResponse = await app.inject({
      method: 'POST',
      url: `/verification-runs/${verificationRunId}/pull-requests`,
      headers: { cookie },
    });
    const { pullRequestAttempt } = createResponse.json() as { pullRequestAttempt: { id: string } };

    const [analysisRunRow] = await db.db
      .select({ analysisRunId: schema.impactAssessments.analysisRunId })
      .from(schema.patchAttempts)
      .innerJoin(
        schema.impactAssessments,
        eq(schema.patchAttempts.impactAssessmentId, schema.impactAssessments.id),
      )
      .where(eq(schema.patchAttempts.id, patchAttemptId));
    if (!analysisRunRow) throw new Error('analysis run not found for patch attempt');

    const response = await app.inject({
      method: 'GET',
      url: `/analysis-runs/${analysisRunRow.analysisRunId}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      analysisRun: {
        assessments: {
          patchAttempts: {
            id: string;
            pullRequestAttempts: { id: string; status: string; verificationRunId?: string }[];
          }[];
        }[];
      };
    };
    const attempt = body.analysisRun.assessments
      .flatMap((a) => a.patchAttempts)
      .find((a) => a.id === patchAttemptId);
    if (!attempt) throw new Error('patch attempt not found in response');

    expect(attempt.pullRequestAttempts).toHaveLength(1);
    expect(attempt.pullRequestAttempts[0]?.id).toBe(pullRequestAttempt.id);
    expect(attempt.pullRequestAttempts[0]?.status).toBe('PENDING');

    await cleanupUser(userId);
  });
});
