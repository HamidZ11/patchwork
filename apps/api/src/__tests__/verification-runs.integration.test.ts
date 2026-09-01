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
describe('verification runs (real database)', () => {
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
  ): Promise<{ app: ReturnType<typeof buildApp>; patchAttemptId: string; analysisRunId: string }> {
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
      patchAttempt: { id: string; status: string };
    };
    if (patchAttempt.status !== 'GENERATED') {
      throw new Error(`expected GENERATED patch attempt, got ${patchAttempt.status}`);
    }

    return { app, patchAttemptId: patchAttempt.id, analysisRunId: analysisRun.id };
  }

  it('returns 401 without a session', async () => {
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/patch-attempts/${crypto.randomUUID()}/verification-runs`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for a patch attempt connected by a different user, without leaking its existence', async () => {
    const { cookie: ownerCookie, userId: ownerId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(ownerId);
    const { patchAttemptId } = await createGeneratedPatchAttempt(ownerCookie, repositoryId);

    const { cookie: otherCookie, userId: otherUserId } = await createAuthenticatedUser();
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/patch-attempts/${patchAttemptId}/verification-runs`,
      headers: { cookie: otherCookie },
    });

    expect(response.statusCode).toBe(404);
    await cleanupUser(otherUserId);
    await cleanupUser(ownerId);
  });

  it('returns 404 for a nonexistent patch attempt', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/patch-attempts/${crypto.randomUUID()}/verification-runs`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
    await cleanupUser(userId);
  });

  it('creates a PENDING verification run for a GENERATED patch attempt', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, patchAttemptId } = await createGeneratedPatchAttempt(cookie, repositoryId);

    const response = await app.inject({
      method: 'POST',
      url: `/patch-attempts/${patchAttemptId}/verification-runs`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { verificationRun: { id: string; status: string } };
    expect(body.verificationRun.status).toBe('PENDING');

    const [persisted] = await db.db
      .select()
      .from(schema.verificationRuns)
      .where(eq(schema.verificationRuns.id, body.verificationRun.id));
    expect(persisted?.patchAttemptId).toBe(patchAttemptId);

    await cleanupUser(userId);
  });

  it('returns the existing in-flight run instead of creating a duplicate on a second POST', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, patchAttemptId } = await createGeneratedPatchAttempt(cookie, repositoryId);

    const first = await app.inject({
      method: 'POST',
      url: `/patch-attempts/${patchAttemptId}/verification-runs`,
      headers: { cookie },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/patch-attempts/${patchAttemptId}/verification-runs`,
      headers: { cookie },
    });

    const firstBody = first.json() as { verificationRun: { id: string } };
    const secondBody = second.json() as {
      verificationRun: { id: string };
      alreadyInFlight?: boolean;
    };
    expect(secondBody.verificationRun.id).toBe(firstBody.verificationRun.id);
    expect(secondBody.alreadyInFlight).toBe(true);

    const rows = await db.db
      .select()
      .from(schema.verificationRuns)
      .where(eq(schema.verificationRuns.patchAttemptId, patchAttemptId));
    expect(rows).toHaveLength(1);

    await cleanupUser(userId);
  });

  it('GET /verification-runs/:id returns 404 for another user, and the full record (with steps) for the owner', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, patchAttemptId } = await createGeneratedPatchAttempt(cookie, repositoryId);

    const createResponse = await app.inject({
      method: 'POST',
      url: `/patch-attempts/${patchAttemptId}/verification-runs`,
      headers: { cookie },
    });
    const { verificationRun } = createResponse.json() as { verificationRun: { id: string } };

    const ownerResponse = await app.inject({
      method: 'GET',
      url: `/verification-runs/${verificationRun.id}`,
      headers: { cookie },
    });
    expect(ownerResponse.statusCode).toBe(200);
    const ownerBody = ownerResponse.json() as {
      verificationRun: { id: string; status: string; steps: unknown[] };
    };
    expect(ownerBody.verificationRun.status).toBe('PENDING');
    expect(ownerBody.verificationRun.steps).toEqual([]);

    const { cookie: otherCookie, userId: otherUserId } = await createAuthenticatedUser();
    const otherResponse = await app.inject({
      method: 'GET',
      url: `/verification-runs/${verificationRun.id}`,
      headers: { cookie: otherCookie },
    });
    expect(otherResponse.statusCode).toBe(404);

    await cleanupUser(otherUserId);
    await cleanupUser(userId);
  });

  describe('GET /analysis-runs/:id includes verification-run evidence', () => {
    async function seedRun(
      patchAttemptId: string,
      overrides: Partial<typeof schema.verificationRuns.$inferInsert>,
    ): Promise<string> {
      const [row] = await db.db
        .insert(schema.verificationRuns)
        .values({ patchAttemptId, status: 'PENDING', ...overrides })
        .returning({ id: schema.verificationRuns.id });
      if (!row) throw new Error('failed to seed verification run');
      return row.id;
    }

    async function seedStep(
      verificationRunId: string,
      overrides: Partial<typeof schema.verificationSteps.$inferInsert>,
    ): Promise<void> {
      await db.db.insert(schema.verificationSteps).values({
        verificationRunId,
        sequence: 1,
        kind: 'test',
        command: 'npm test',
        status: 'PASSED',
        ...overrides,
      });
    }

    async function fetchVerificationRuns(
      app: ReturnType<typeof buildApp>,
      cookie: string,
      analysisRunId: string,
      patchAttemptId: string,
    ) {
      const response = await app.inject({
        method: 'GET',
        url: `/analysis-runs/${analysisRunId}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        analysisRun: {
          assessments: {
            patchAttempts: {
              id: string;
              verificationRuns: {
                id: string;
                status: string;
                failureCategory: string | null;
                failureReason: string | null;
                sandboxProvider: string | null;
                nodeVersion: string | null;
                nodeVersionSource: string | null;
                packageManager: string | null;
                createdAt: string;
                steps: {
                  sequence: number;
                  kind: string;
                  status: string;
                  truncated: boolean;
                  stdoutExcerpt: string | null;
                }[];
              }[];
            }[];
          }[];
        };
      };
      const attempt = body.analysisRun.assessments
        .flatMap((a) => a.patchAttempts)
        .find((a) => a.id === patchAttemptId);
      if (!attempt) throw new Error('patch attempt not found in response');
      return attempt.verificationRuns;
    }

    it('reports PENDING with no steps yet', async () => {
      const { cookie, userId } = await createAuthenticatedUser();
      const { repositoryId } = await connectRepository(userId);
      const { app, patchAttemptId, analysisRunId } = await createGeneratedPatchAttempt(
        cookie,
        repositoryId,
      );
      await seedRun(patchAttemptId, { status: 'PENDING' });

      const runs = await fetchVerificationRuns(app, cookie, analysisRunId, patchAttemptId);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe('PENDING');
      expect(runs[0]?.steps).toEqual([]);

      await cleanupUser(userId);
    });

    it('reports RUNNING', async () => {
      const { cookie, userId } = await createAuthenticatedUser();
      const { repositoryId } = await connectRepository(userId);
      const { app, patchAttemptId, analysisRunId } = await createGeneratedPatchAttempt(
        cookie,
        repositoryId,
      );
      await seedRun(patchAttemptId, { status: 'RUNNING', startedAt: new Date() });

      const runs = await fetchVerificationRuns(app, cookie, analysisRunId, patchAttemptId);
      expect(runs[0]?.status).toBe('RUNNING');

      await cleanupUser(userId);
    });

    it('reports PASSED with per-step evidence', async () => {
      const { cookie, userId } = await createAuthenticatedUser();
      const { repositoryId } = await connectRepository(userId);
      const { app, patchAttemptId, analysisRunId } = await createGeneratedPatchAttempt(
        cookie,
        repositoryId,
      );
      const runId = await seedRun(patchAttemptId, {
        status: 'PASSED',
        sandboxProvider: 'e2b',
        sandboxRuntime: 'patchwork-verification-node20',
        nodeVersion: '20',
        nodeVersionSource: 'patchwork_default',
        packageManager: 'npm',
        manifestVersion: '1',
        completedAt: new Date(),
      });
      await seedStep(runId, { sequence: 1, kind: 'patch_apply', status: 'PASSED' });
      await seedStep(runId, { sequence: 2, kind: 'install', status: 'PASSED' });
      await seedStep(runId, { sequence: 3, kind: 'typecheck', status: 'PASSED' });
      await seedStep(runId, { sequence: 4, kind: 'test', status: 'PASSED' });

      const runs = await fetchVerificationRuns(app, cookie, analysisRunId, patchAttemptId);
      expect(runs[0]?.status).toBe('PASSED');
      expect(runs[0]?.nodeVersionSource).toBe('patchwork_default');
      expect(runs[0]?.steps.map((s) => s.kind)).toEqual([
        'patch_apply',
        'install',
        'typecheck',
        'test',
      ]);

      await cleanupUser(userId);
    });

    it('reports FAILED with a customer-repo-failure category and the failing step', async () => {
      const { cookie, userId } = await createAuthenticatedUser();
      const { repositoryId } = await connectRepository(userId);
      const { app, patchAttemptId, analysisRunId } = await createGeneratedPatchAttempt(
        cookie,
        repositoryId,
      );
      const runId = await seedRun(patchAttemptId, {
        status: 'FAILED',
        failureCategory: 'CUSTOMER_REPO_FAILURE',
        failureReason: 'one or more verification commands failed',
        sandboxProvider: 'e2b',
      });
      await seedStep(runId, { sequence: 1, kind: 'patch_apply', status: 'PASSED' });
      await seedStep(runId, { sequence: 2, kind: 'install', status: 'PASSED' });
      await seedStep(runId, { sequence: 3, kind: 'typecheck', status: 'PASSED' });
      await seedStep(runId, {
        sequence: 4,
        kind: 'test',
        status: 'FAILED',
        exitCode: 1,
        stdoutExcerpt: 'FAIL src/billing.test.ts',
      });

      const runs = await fetchVerificationRuns(app, cookie, analysisRunId, patchAttemptId);
      expect(runs[0]?.status).toBe('FAILED');
      expect(runs[0]?.failureCategory).toBe('CUSTOMER_REPO_FAILURE');
      expect(runs[0]?.steps.find((s) => s.kind === 'test')?.status).toBe('FAILED');

      await cleanupUser(userId);
    });

    it('reports FAILED with a patch-failure category', async () => {
      const { cookie, userId } = await createAuthenticatedUser();
      const { repositoryId } = await connectRepository(userId);
      const { app, patchAttemptId, analysisRunId } = await createGeneratedPatchAttempt(
        cookie,
        repositoryId,
      );
      await seedRun(patchAttemptId, {
        status: 'FAILED',
        failureCategory: 'PATCH_FAILURE',
        failureReason: 'candidate patch failed to apply',
      });

      const runs = await fetchVerificationRuns(app, cookie, analysisRunId, patchAttemptId);
      expect(runs[0]?.failureCategory).toBe('PATCH_FAILURE');

      await cleanupUser(userId);
    });

    it('reports REFUSED with no sandbox/manifest evidence', async () => {
      const { cookie, userId } = await createAuthenticatedUser();
      const { repositoryId } = await connectRepository(userId);
      const { app, patchAttemptId, analysisRunId } = await createGeneratedPatchAttempt(
        cookie,
        repositoryId,
      );
      await seedRun(patchAttemptId, {
        status: 'REFUSED',
        failureCategory: 'POLICY_REFUSAL',
        failureReason: 'no allowlisted registry host for this package manager',
      });

      const runs = await fetchVerificationRuns(app, cookie, analysisRunId, patchAttemptId);
      expect(runs[0]?.status).toBe('REFUSED');
      expect(runs[0]?.sandboxProvider).toBeNull();

      await cleanupUser(userId);
    });

    it('reports TIMED_OUT', async () => {
      const { cookie, userId } = await createAuthenticatedUser();
      const { repositoryId } = await connectRepository(userId);
      const { app, patchAttemptId, analysisRunId } = await createGeneratedPatchAttempt(
        cookie,
        repositoryId,
      );
      await seedRun(patchAttemptId, {
        status: 'TIMED_OUT',
        failureCategory: 'TIMEOUT',
        failureReason: 'a verification command exceeded its time budget',
      });

      const runs = await fetchVerificationRuns(app, cookie, analysisRunId, patchAttemptId);
      expect(runs[0]?.status).toBe('TIMED_OUT');

      await cleanupUser(userId);
    });

    it('reports INFRA_ERROR', async () => {
      const { cookie, userId } = await createAuthenticatedUser();
      const { repositoryId } = await connectRepository(userId);
      const { app, patchAttemptId, analysisRunId } = await createGeneratedPatchAttempt(
        cookie,
        repositoryId,
      );
      await seedRun(patchAttemptId, {
        status: 'INFRA_ERROR',
        failureCategory: 'SANDBOX_INFRA_FAILURE',
        failureReason: 'sandbox creation failed',
      });

      const runs = await fetchVerificationRuns(app, cookie, analysisRunId, patchAttemptId);
      expect(runs[0]?.status).toBe('INFRA_ERROR');

      await cleanupUser(userId);
    });

    it('orders multiple historical runs newest-first', async () => {
      const { cookie, userId } = await createAuthenticatedUser();
      const { repositoryId } = await connectRepository(userId);
      const { app, patchAttemptId, analysisRunId } = await createGeneratedPatchAttempt(
        cookie,
        repositoryId,
      );
      const older = new Date(Date.now() - 60_000);
      const newer = new Date();
      await seedRun(patchAttemptId, { status: 'FAILED', createdAt: older });
      await seedRun(patchAttemptId, { status: 'PASSED', createdAt: newer });

      const runs = await fetchVerificationRuns(app, cookie, analysisRunId, patchAttemptId);
      expect(runs).toHaveLength(2);
      expect(runs[0]?.status).toBe('PASSED');
      expect(runs[1]?.status).toBe('FAILED');

      await cleanupUser(userId);
    });

    it('surfaces the truncated flag on a step', async () => {
      const { cookie, userId } = await createAuthenticatedUser();
      const { repositoryId } = await connectRepository(userId);
      const { app, patchAttemptId, analysisRunId } = await createGeneratedPatchAttempt(
        cookie,
        repositoryId,
      );
      const runId = await seedRun(patchAttemptId, { status: 'FAILED' });
      await seedStep(runId, {
        sequence: 1,
        kind: 'test',
        status: 'FAILED',
        stdoutExcerpt: 'partial output only',
        truncated: true,
      });

      const runs = await fetchVerificationRuns(app, cookie, analysisRunId, patchAttemptId);
      expect(runs[0]?.steps[0]?.truncated).toBe(true);

      await cleanupUser(userId);
    });

    it('does not leak verification-run evidence to a different user', async () => {
      const { cookie: ownerCookie, userId: ownerId } = await createAuthenticatedUser();
      const { repositoryId } = await connectRepository(ownerId);
      const { patchAttemptId, analysisRunId } = await createGeneratedPatchAttempt(
        ownerCookie,
        repositoryId,
      );
      await seedRun(patchAttemptId, { status: 'PASSED' });

      const { cookie: otherCookie, userId: otherUserId } = await createAuthenticatedUser();
      const app = buildApp(testAppDeps({ db }));
      const response = await app.inject({
        method: 'GET',
        url: `/analysis-runs/${analysisRunId}`,
        headers: { cookie: otherCookie },
      });
      expect(response.statusCode).toBe(404);

      await cleanupUser(otherUserId);
      await cleanupUser(ownerId);
    });
  });
});
