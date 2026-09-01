import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { loadEnv } from '@patchwork/config';
import { createDbClient, schema, type DbClient } from '@patchwork/db';
import { buildApp } from '../app.js';
import { createSession } from '../auth/sessions.js';
import { findOrCreateUserByGitHubProfile } from '../auth/users.js';
import type { GitHubInstallationInfo, GitHubRepository } from '../github/client.js';
import { upsertInstallationAndRepositories } from '../github/persistence.js';
import { STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE } from '../analysis/impact/rules/stripe-basil-invoice-subscription.js';
import { STRIPE_BASIL_RETRIEVE_UPCOMING_RULE } from '../analysis/impact/rules/stripe-basil-retrieve-upcoming.js';
import {
  fakeGitHubAppAuth,
  fakeGitHubClientWithArchive,
  testAppDeps,
  uniqueGithubId,
} from './fixtures.js';

const STRIPE_IMPORT = "import Stripe from 'stripe';";

function affectedFixtureFiles(bodyLine = 'return invoice.subscription;'): Record<string, string> {
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
      `  ${bodyLine}`,
      '}',
    ].join('\n'),
  };
}

function uncertainFixtureFiles(): Record<string, string> {
  // No lockfile at all -> applicability UNKNOWN -> UNCERTAIN, matching the
  // existing benchmark case's own "unknown-version" fixture shape.
  return {
    'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
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

function notAffectedFixtureFiles(): Record<string, string> {
  return {
    'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
    'package-lock.json': JSON.stringify({
      packages: { '': {}, 'node_modules/stripe': { version: '18.2.0' } },
    }),
    'src/billing.ts': [
      STRIPE_IMPORT,
      "const stripe = new Stripe('sk_test');",
      "const legacyRecord = { subscription: 'sub_123' };",
      'const value = legacyRecord.subscription;',
    ].join('\n'),
  };
}

// Requires a reachable, migrated PostgreSQL instance (see docs/testing.md).
describe('patch attempts (real database)', () => {
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

  async function triggerAnalysisAndAssess(
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
    await app.inject({
      method: 'POST',
      url: `/analysis-runs/${body.analysisRun.id}/impact-assessments`,
      headers: { cookie },
    });
    return { app, analysisRunId: body.analysisRun.id };
  }

  async function getAssessmentId(analysisRunId: string, ruleExternalId: string): Promise<string> {
    const [row] = await db.db
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
          eq(schema.impactAssessments.analysisRunId, analysisRunId),
          eq(schema.providerChanges.externalId, ruleExternalId),
        ),
      );
    if (!row) throw new Error(`no assessment found for rule ${ruleExternalId}`);
    return row.id;
  }

  it('returns 401 without a session', async () => {
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${crypto.randomUUID()}/patch-attempts`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for an assessment connected by a different user, without leaking its existence', async () => {
    const { cookie: ownerCookie, userId: ownerId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(ownerId);
    const { analysisRunId } = await triggerAnalysisAndAssess(
      ownerCookie,
      repositoryId,
      affectedFixtureFiles(),
    );
    const assessmentId = await getAssessmentId(
      analysisRunId,
      STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE.providerChange.externalId,
    );

    const { cookie: otherCookie, userId: otherUserId } = await createAuthenticatedUser();
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessmentId}/patch-attempts`,
      headers: { cookie: otherCookie },
    });

    expect(response.statusCode).toBe(404);
    await cleanupUser(otherUserId);
    await cleanupUser(ownerId);
  });

  it('returns 404 for a nonexistent assessment', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${crypto.randomUUID()}/patch-attempts`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
    await cleanupUser(userId);
  });

  it('generates and persists a verified candidate patch for a supported AFFECTED assessment', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, analysisRunId } = await triggerAnalysisAndAssess(
      cookie,
      repositoryId,
      affectedFixtureFiles(),
    );
    const assessmentId = await getAssessmentId(
      analysisRunId,
      STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE.providerChange.externalId,
    );

    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessmentId}/patch-attempts`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      patchAttempt: {
        id: string;
        status: string;
        transformationKind: string;
        changedFiles: string[];
        diff: string;
        postconditionResult: { name: string; passed: boolean }[];
      };
    };
    expect(body.patchAttempt.status).toBe('GENERATED');
    expect(body.patchAttempt.transformationKind).toBe('stripe_invoice_subscription_to_parent');
    expect(body.patchAttempt.changedFiles).toEqual(['src/billing.ts']);
    expect(body.patchAttempt.diff).toContain('-  return invoice.subscription;');
    expect(body.patchAttempt.diff).toContain(
      '+  return (invoice.parent?.subscription_details?.subscription ?? null);',
    );
    expect(body.patchAttempt.postconditionResult.every((c) => c.passed)).toBe(true);

    const [persisted] = await db.db
      .select()
      .from(schema.patchAttempts)
      .where(eq(schema.patchAttempts.id, body.patchAttempt.id));
    expect(persisted).toBeDefined();
    expect(persisted?.status).toBe('GENERATED');

    await cleanupUser(userId);
  });

  it('refuses (does not patch) an UNCERTAIN assessment', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, analysisRunId } = await triggerAnalysisAndAssess(
      cookie,
      repositoryId,
      uncertainFixtureFiles(),
    );
    const assessmentId = await getAssessmentId(
      analysisRunId,
      STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE.providerChange.externalId,
    );

    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessmentId}/patch-attempts`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { patchAttempt: { status: string; refusalReason: string } };
    expect(body.patchAttempt.status).toBe('REFUSED');
    expect(body.patchAttempt.refusalReason).toMatch(/not AFFECTED/i);

    await cleanupUser(userId);
  });

  it('refuses (does not patch) a NOT_AFFECTED assessment', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, analysisRunId } = await triggerAnalysisAndAssess(
      cookie,
      repositoryId,
      notAffectedFixtureFiles(),
    );
    const assessmentId = await getAssessmentId(
      analysisRunId,
      STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE.providerChange.externalId,
    );

    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessmentId}/patch-attempts`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { patchAttempt: { status: string; refusalReason: string } };
    expect(body.patchAttempt.status).toBe('REFUSED');
    expect(body.patchAttempt.refusalReason).toMatch(/not AFFECTED/i);

    await cleanupUser(userId);
  });

  it('refuses (does not patch) an assessment for an unsupported rule', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, analysisRunId } = await triggerAnalysisAndAssess(cookie, repositoryId, {
      'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
      'package-lock.json': JSON.stringify({
        packages: { '': {}, 'node_modules/stripe': { version: '18.2.0' } },
      }),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
      ].join('\n'),
    });
    const assessmentId = await getAssessmentId(
      analysisRunId,
      STRIPE_BASIL_RETRIEVE_UPCOMING_RULE.providerChange.externalId,
    );

    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessmentId}/patch-attempts`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { patchAttempt: { status: string; refusalReason: string } };
    expect(body.patchAttempt.status).toBe('REFUSED');
    expect(body.patchAttempt.refusalReason).toMatch(/no supported deterministic remediation/i);

    await cleanupUser(userId);
  });

  it('re-triggering the same assessment creates a separate audit-log attempt row, not an upsert', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, analysisRunId } = await triggerAnalysisAndAssess(
      cookie,
      repositoryId,
      affectedFixtureFiles(),
    );
    const assessmentId = await getAssessmentId(
      analysisRunId,
      STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE.providerChange.externalId,
    );

    await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessmentId}/patch-attempts`,
      headers: { cookie },
    });
    await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessmentId}/patch-attempts`,
      headers: { cookie },
    });

    const rows = await db.db
      .select()
      .from(schema.patchAttempts)
      .where(eq(schema.patchAttempts.impactAssessmentId, assessmentId));
    expect(rows).toHaveLength(2);

    await cleanupUser(userId);
  });

  it('GET /analysis-runs/:id includes patch attempts and remediation support alongside each assessment', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { app, analysisRunId } = await triggerAnalysisAndAssess(
      cookie,
      repositoryId,
      affectedFixtureFiles(),
    );
    const assessmentId = await getAssessmentId(
      analysisRunId,
      STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE.providerChange.externalId,
    );

    await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessmentId}/patch-attempts`,
      headers: { cookie },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/analysis-runs/${analysisRunId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      analysisRun: {
        assessments: {
          id: string;
          predicateKind: string;
          remediationSupported: boolean;
          patchAttempts: { status: string }[];
        }[];
      };
    };

    const assessment = body.analysisRun.assessments.find((a) => a.id === assessmentId);
    expect(assessment?.predicateKind).toBe('stripe_invoice_subscription_property');
    expect(assessment?.remediationSupported).toBe(true);
    expect(assessment?.patchAttempts).toHaveLength(1);
    expect(assessment?.patchAttempts[0]?.status).toBe('GENERATED');

    const unsupported = body.analysisRun.assessments.find(
      (a) => a.predicateKind !== 'stripe_invoice_subscription_property',
    );
    expect(unsupported?.remediationSupported).toBe(false);

    await cleanupUser(userId);
  });
});
