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
  ): Promise<{ app: ReturnType<typeof buildApp>; patchAttemptId: string }> {
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

    return { app, patchAttemptId: patchAttempt.id };
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
});
