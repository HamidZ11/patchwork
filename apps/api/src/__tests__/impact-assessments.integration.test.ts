import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadEnv } from '@patchwork/config';
import { createDbClient, schema, type DbClient } from '@patchwork/db';
import { buildApp } from '../app.js';
import { createSession } from '../auth/sessions.js';
import { findOrCreateUserByGitHubProfile } from '../auth/users.js';
import type { GitHubInstallationInfo, GitHubRepository } from '../github/client.js';
import { upsertInstallationAndRepositories } from '../github/persistence.js';
import { upsertProviderChangeAndRuleVersion } from '../analysis/impact-persistence.js';
import { STRIPE_BASIL_INVOICE_PREVIEW } from '../analysis/impact/stripe-basil-invoice-preview.js';
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
      'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
    ].join('\n'),
  };
}

function notAffectedFixtureFiles(): Record<string, string> {
  return {
    'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
    'package-lock.json': JSON.stringify({
      packages: { '': {}, 'node_modules/stripe': { version: '18.2.0' } },
    }),
    'src/billing.ts': [
      STRIPE_IMPORT,
      "const stripe = new Stripe('sk_test');",
      'stripe.invoices.createPreview({});',
    ].join('\n'),
  };
}

// Requires a reachable, migrated PostgreSQL instance (see docs/testing.md).
// Each test uses unique GitHub ids and cleans up exactly the rows it created.
describe('impact assessments (real database)', () => {
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

  async function triggerAnalysis(
    cookie: string,
    repositoryId: string,
    files: Record<string, string>,
  ): Promise<{ app: ReturnType<typeof buildApp>; analysisRunId: string }> {
    const githubClient = fakeGitHubClientWithArchive(files, {
      getBranchCommitSha: async () => 'a'.repeat(40),
    });
    const app = buildApp(testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth() }));
    const response = await app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/analyses`,
      headers: { cookie },
    });
    const body = response.json() as { analysisRun: { id: string } };
    return { app, analysisRunId: body.analysisRun.id };
  }

  it('returns 401 without a session', async () => {
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/analysis-runs/${crypto.randomUUID()}/impact-assessments`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an analysis run connected by a different user, without leaking its existence', async () => {
    const { cookie: ownerCookie, userId: ownerId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(ownerId);
    const { analysisRunId } = await triggerAnalysis(
      ownerCookie,
      repositoryId,
      affectedFixtureFiles(),
    );

    const { cookie: otherCookie, userId: otherUserId } = await createAuthenticatedUser();
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/analysis-runs/${analysisRunId}/impact-assessments`,
      headers: { cookie: otherCookie },
    });

    expect(response.statusCode).toBe(404);
    await cleanupUser(otherUserId);
    await cleanupUser(ownerId);
  });

  it('returns 409 when the analysis run has no evidence (archive acquisition failed)', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);

    const githubClient = fakeGitHubClientWithArchive(affectedFixtureFiles(), {
      getBranchCommitSha: async () => 'a'.repeat(40),
      downloadRepositoryArchive: async () => {
        throw new Error('archive download failed');
      },
    });
    const app = buildApp(testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth() }));
    const trigger = await app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/analyses`,
      headers: { cookie },
    });
    const { analysisRun } = trigger.json() as { analysisRun: { id: string; status: string } };
    expect(analysisRun.status).toBe('failed');

    const response = await app.inject({
      method: 'POST',
      url: `/analysis-runs/${analysisRun.id}/impact-assessments`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(409);

    await cleanupUser(userId);
  });

  it('persists an AFFECTED assessment with a Finding for a real matching fixture', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, analysisRunId } = await triggerAnalysis(
      cookie,
      repositoryId,
      affectedFixtureFiles(),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/analysis-runs/${analysisRunId}/impact-assessments`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      impactAssessments: {
        status: string;
        providerChange: { title: string; sourceUrl: string };
        findings: { sourceFile: string; matchedSymbol: string }[];
      }[];
    };
    expect(body.impactAssessments).toHaveLength(1);
    expect(body.impactAssessments[0]?.status).toBe('AFFECTED');
    expect(body.impactAssessments[0]?.providerChange.title).toBe(
      STRIPE_BASIL_INVOICE_PREVIEW.title,
    );
    expect(body.impactAssessments[0]?.findings).toEqual([
      expect.objectContaining({
        sourceFile: 'src/billing.ts',
        matchedSymbol: 'stripe.invoices.retrieveUpcoming',
      }),
    ]);

    const assessments = await db.db
      .select()
      .from(schema.impactAssessments)
      .where(eq(schema.impactAssessments.analysisRunId, analysisRunId));
    expect(assessments).toHaveLength(1);
    expect(assessments[0]!.status).toBe('AFFECTED');

    const findings = await db.db
      .select()
      .from(schema.impactFindings)
      .where(eq(schema.impactFindings.impactAssessmentId, assessments[0]!.id));
    expect(findings).toHaveLength(1);

    await cleanupUser(userId);
  });

  it('persists a NOT_AFFECTED assessment for a fixture that never calls retrieveUpcoming', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, analysisRunId } = await triggerAnalysis(
      cookie,
      repositoryId,
      notAffectedFixtureFiles(),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/analysis-runs/${analysisRunId}/impact-assessments`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      impactAssessments: { status: string; findings: unknown[] }[];
    };
    expect(body.impactAssessments[0]?.status).toBe('NOT_AFFECTED');
    expect(body.impactAssessments[0]?.findings).toHaveLength(0);

    await cleanupUser(userId);
  });

  it('re-triggering the same analysis run converges to one assessment row (upsert, findings replaced)', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, analysisRunId } = await triggerAnalysis(
      cookie,
      repositoryId,
      affectedFixtureFiles(),
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: `/analysis-runs/${analysisRunId}/impact-assessments`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(201);
    }

    const assessments = await db.db
      .select()
      .from(schema.impactAssessments)
      .where(eq(schema.impactAssessments.analysisRunId, analysisRunId));
    expect(assessments).toHaveLength(1);

    const findings = await db.db
      .select()
      .from(schema.impactFindings)
      .where(eq(schema.impactFindings.impactAssessmentId, assessments[0]!.id));
    expect(findings).toHaveLength(1); // not duplicated across the two triggers

    await cleanupUser(userId);
  });

  it('upserting the ProviderChange/RuleVersion definition twice converges to one row each', async () => {
    const first = await upsertProviderChangeAndRuleVersion(db.db, STRIPE_BASIL_INVOICE_PREVIEW);
    const second = await upsertProviderChangeAndRuleVersion(db.db, STRIPE_BASIL_INVOICE_PREVIEW);
    expect(first.ruleVersionId).toBe(second.ruleVersionId);

    const providerChanges = await db.db
      .select()
      .from(schema.providerChanges)
      .where(eq(schema.providerChanges.externalId, STRIPE_BASIL_INVOICE_PREVIEW.externalId));
    expect(providerChanges).toHaveLength(1);
  });

  it('cascades: deleting an ImpactAssessment removes its Findings', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, analysisRunId } = await triggerAnalysis(
      cookie,
      repositoryId,
      affectedFixtureFiles(),
    );

    await app.inject({
      method: 'POST',
      url: `/analysis-runs/${analysisRunId}/impact-assessments`,
      headers: { cookie },
    });

    const [assessment] = await db.db
      .select()
      .from(schema.impactAssessments)
      .where(eq(schema.impactAssessments.analysisRunId, analysisRunId));
    expect(assessment).toBeDefined();

    await db.db
      .delete(schema.impactAssessments)
      .where(eq(schema.impactAssessments.id, assessment!.id));

    const remainingFindings = await db.db
      .select()
      .from(schema.impactFindings)
      .where(eq(schema.impactFindings.impactAssessmentId, assessment!.id));
    expect(remainingFindings).toHaveLength(0);

    await cleanupUser(userId);
  });
});
