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
import { STRIPE_BASIL_ISSUING_AUTHORIZATION_STATUS_RULE } from '../analysis/impact/rules/stripe-basil-issuing-authorization-status.js';
import { EXPLANATION_PROMPT_VERSION, type ExplanationContext } from '../explanations/types.js';
import {
  fakeExplanationModel,
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

/** No lockfile -> the SDK version cannot be resolved -> applicability UNKNOWN
 * -> UNCERTAIN. The same shape the benchmark's own unknown-version case uses. */
function uncertainFixtureFiles(): Record<string, string> {
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

// Requires a reachable, migrated PostgreSQL instance (see docs/testing.md).
describe('impact explanations (real database)', () => {
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
    const installation: GitHubInstallationInfo = {
      id: uniqueGithubId(),
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

  async function analyse(
    cookie: string,
    repositoryId: string,
    files: Record<string, string>,
    deps: Parameters<typeof testAppDeps>[0] = {},
  ): Promise<{ app: ReturnType<typeof buildApp>; analysisRunId: string }> {
    const githubClient = fakeGitHubClientWithArchive(files, {
      getBranchCommitSha: async () => 'a'.repeat(40),
    });
    const app = buildApp(
      testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth(), ...deps }),
    );
    const response = await app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/analyses`,
      headers: { cookie },
    });
    const { analysisRun } = response.json() as { analysisRun: { id: string } };
    await app.inject({
      method: 'POST',
      url: `/analysis-runs/${analysisRun.id}/impact-assessments`,
      headers: { cookie },
    });
    return { app, analysisRunId: analysisRun.id };
  }

  async function getAssessment(
    analysisRunId: string,
    ruleExternalId: string,
  ): Promise<{ id: string; status: string }> {
    const [row] = await db.db
      .select({ id: schema.impactAssessments.id, status: schema.impactAssessments.status })
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
    if (!row) throw new Error(`no assessment for rule ${ruleExternalId}`);
    return row;
  }

  const INVOICE_RULE = STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE.providerChange.externalId;
  const ISSUING_RULE = STRIPE_BASIL_ISSUING_AUTHORIZATION_STATUS_RULE.providerChange.externalId;

  it('returns 401 without a session', async () => {
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${crypto.randomUUID()}/explanation`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('generates and persists an explanation for an authorized AFFECTED assessment', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const model = fakeExplanationModel();
    const { app, analysisRunId } = await analyse(cookie, repositoryId, affectedFixtureFiles(), {
      explanationModel: model,
    });
    const assessment = await getAssessment(analysisRunId, INVOICE_RULE);
    expect(assessment.status).toBe('AFFECTED');

    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      explanation: { summary: string; whyItMatters: string; nextStep: string };
      cached: boolean;
    };
    expect(body.cached).toBe(false);
    expect(body.explanation.summary).toContain('AFFECTED');
    expect(model.calls.count).toBe(1);

    const rows = await db.db
      .select()
      .from(schema.impactExplanations)
      .where(eq(schema.impactExplanations.impactAssessmentId, assessment.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.promptVersion).toBe(EXPLANATION_PROMPT_VERSION);
    expect(rows[0]?.model).toBe('test-explanation-model');

    await cleanupUser(userId);
  });

  it('reuses the cached explanation without calling the model again', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const model = fakeExplanationModel();
    const { app, analysisRunId } = await analyse(cookie, repositoryId, affectedFixtureFiles(), {
      explanationModel: model,
    });
    const assessment = await getAssessment(analysisRunId, INVOICE_RULE);

    const first = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { cached: boolean }).cached).toBe(true);
    expect(model.calls.count).toBe(1); // the paid call happened exactly once

    const rows = await db.db
      .select()
      .from(schema.impactExplanations)
      .where(eq(schema.impactExplanations.impactAssessmentId, assessment.id));
    expect(rows).toHaveLength(1);

    await cleanupUser(userId);
  });

  it('treats the model as part of the cache identity, so a different model regenerates', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const modelA = fakeExplanationModel({ model: 'model-a' });
    const { app, analysisRunId } = await analyse(cookie, repositoryId, affectedFixtureFiles(), {
      explanationModel: modelA,
    });
    const assessment = await getAssessment(analysisRunId, INVOICE_RULE);
    await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });

    const modelB = fakeExplanationModel({ model: 'model-b' });
    const appB = buildApp(testAppDeps({ db, explanationModel: modelB }));
    const response = await appB.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201); // a miss, not a stale hit
    expect(modelB.calls.count).toBe(1);

    // Both generations are kept -- regeneration is append-only, not overwrite.
    const rows = await db.db
      .select()
      .from(schema.impactExplanations)
      .where(eq(schema.impactExplanations.impactAssessmentId, assessment.id));
    expect(rows.map((row) => row.model).sort()).toEqual(['model-a', 'model-b']);

    await cleanupUser(userId);
  });

  it('returns 404 for an assessment connected by a different user, without leaking its existence', async () => {
    const { cookie: ownerCookie, userId: ownerId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(ownerId);
    const { analysisRunId } = await analyse(ownerCookie, repositoryId, affectedFixtureFiles());
    const assessment = await getAssessment(analysisRunId, INVOICE_RULE);

    const { cookie: otherCookie, userId: otherId } = await createAuthenticatedUser();
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie: otherCookie },
    });

    expect(response.statusCode).toBe(404);
    expect((response.json() as { message: string }).message).toBe('Impact assessment not found.');

    // Nothing was generated or persisted for the non-owner's request.
    const rows = await db.db
      .select()
      .from(schema.impactExplanations)
      .where(eq(schema.impactExplanations.impactAssessmentId, assessment.id));
    expect(rows).toHaveLength(0);

    await cleanupUser(otherId);
    await cleanupUser(ownerId);
  });

  it('explains an UNCERTAIN assessment with the verdict preserved as UNCERTAIN', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    let seen: ExplanationContext | undefined;
    const model = fakeExplanationModel({
      generate: async (context) => {
        seen = context;
        return {
          explanation: {
            summary: 'Patchwork could not determine whether this change applies.',
            whyItMatters: 'The installed Stripe version could not be resolved.',
            nextStep: 'Resolve the version to let Patchwork conclude.',
          },
          usage: null,
        };
      },
    });
    const { app, analysisRunId } = await analyse(cookie, repositoryId, uncertainFixtureFiles(), {
      explanationModel: model,
    });
    const assessment = await getAssessment(analysisRunId, INVOICE_RULE);
    expect(assessment.status).toBe('UNCERTAIN');

    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    // The context hands the model the calibrated verdict itself, never a
    // softened one -- there is no path by which "UNCERTAIN" reaches the model
    // as "probably unaffected".
    expect(seen?.verdict).toBe('UNCERTAIN');
    expect(seen?.applicability.some((entry) => entry.applicability === 'UNKNOWN')).toBe(true);

    await cleanupUser(userId);
  });

  it('refuses to explain a NOT_AFFECTED assessment, even when asked directly', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const model = fakeExplanationModel();
    const { app, analysisRunId } = await analyse(cookie, repositoryId, affectedFixtureFiles(), {
      explanationModel: model,
    });
    // The Issuing rule is NOT_AFFECTED against this fixture.
    const assessment = await getAssessment(analysisRunId, ISSUING_RULE);
    expect(assessment.status).toBe('NOT_AFFECTED');

    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(409);
    expect((response.json() as { message: string }).message).toContain('NOT_AFFECTED');
    expect(model.calls.count).toBe(0); // no spend on a proven negative

    await cleanupUser(userId);
  });

  it('does not persist invalid model output, and does not serve it later as a cache hit', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const badModel = fakeExplanationModel({
      generate: async () => {
        throw new (await import('../explanations/openai.js')).ExplanationModelError(
          'bad shape',
          'invalid_output',
        );
      },
    });
    const { app, analysisRunId } = await analyse(cookie, repositoryId, affectedFixtureFiles(), {
      explanationModel: badModel,
    });
    const assessment = await getAssessment(analysisRunId, INVOICE_RULE);

    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(502);
    const rows = await db.db
      .select()
      .from(schema.impactExplanations)
      .where(eq(schema.impactExplanations.impactAssessmentId, assessment.id));
    expect(rows).toHaveLength(0);

    await cleanupUser(userId);
  });

  it('reports an unconfigured provider distinguishably, without a retry invitation', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const { createUnconfiguredExplanationModel } = await import('../explanations/openai.js');
    const { app, analysisRunId } = await analyse(cookie, repositoryId, affectedFixtureFiles(), {
      explanationModel: createUnconfiguredExplanationModel(),
    });
    const assessment = await getAssessment(analysisRunId, INVOICE_RULE);

    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });

    // 503, not 502: a deployment without a provider is not a transient fault.
    expect(response.statusCode).toBe(503);
    expect((response.json() as { message: string }).message).toContain('not enabled');

    // The assessment is still fully readable; only this one block is degraded.
    const [row] = await db.db
      .select()
      .from(schema.impactAssessments)
      .where(eq(schema.impactAssessments.id, assessment.id));
    expect(row?.status).toBe('AFFECTED');

    await cleanupUser(userId);
  });

  it('leaves the assessment itself untouched when the model fails', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    const failing = fakeExplanationModel({
      generate: async () => {
        throw new Error('upstream timeout');
      },
    });
    const { app, analysisRunId } = await analyse(cookie, repositoryId, affectedFixtureFiles(), {
      explanationModel: failing,
    });
    const assessment = await getAssessment(analysisRunId, INVOICE_RULE);

    const [before] = await db.db
      .select()
      .from(schema.impactAssessments)
      .where(eq(schema.impactAssessments.id, assessment.id));
    const findingsBefore = await db.db
      .select()
      .from(schema.impactFindings)
      .where(eq(schema.impactFindings.impactAssessmentId, assessment.id));

    const response = await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(502);

    const [after] = await db.db
      .select()
      .from(schema.impactAssessments)
      .where(eq(schema.impactAssessments.id, assessment.id));
    const findingsAfter = await db.db
      .select()
      .from(schema.impactFindings)
      .where(eq(schema.impactFindings.impactAssessmentId, assessment.id));

    expect(after).toEqual(before);
    expect(findingsAfter).toEqual(findingsBefore);
    // The deterministic verdict is still exactly what the analyzer decided.
    expect(after?.status).toBe('AFFECTED');

    await cleanupUser(userId);
  });

  it('sends only assessment-scoped facts, never repository source or credentials', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    let seen: ExplanationContext | undefined;
    const model = fakeExplanationModel({
      generate: async (context) => {
        seen = context;
        return {
          explanation: { summary: 's', whyItMatters: 'w', nextStep: 'n' },
          usage: null,
        };
      },
    });
    const { app, analysisRunId } = await analyse(cookie, repositoryId, affectedFixtureFiles(), {
      explanationModel: model,
    });
    const assessment = await getAssessment(analysisRunId, INVOICE_RULE);
    await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });

    if (!seen) throw new Error('model was not called');
    expect(Object.keys(seen).sort()).toEqual([
      'applicability',
      'findings',
      'findingsCount',
      'installedStripeSdk',
      'migrationRequirement',
      'providerChange',
      'pullRequest',
      'remediation',
      'verdict',
      'verification',
    ]);

    // Findings carry a location, never the line of code at it.
    for (const finding of seen.findings) {
      expect(Object.keys(finding).sort()).toEqual(['line', 'matchedSymbol', 'sourceFile']);
    }

    // Nothing that could carry a secret or repository contents is present
    // anywhere in the serialized payload.
    const serialized = JSON.stringify(seen);
    for (const forbidden of [
      STRIPE_IMPORT,
      'sk_test',
      'package-lock.json',
      'installationId',
      'token',
      'apiKey',
      'private',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    await cleanupUser(userId);
  });

  it('reports remediation and verification state to the model exactly as persisted', async () => {
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);
    let seen: ExplanationContext | undefined;
    const model = fakeExplanationModel({
      generate: async (context) => {
        seen = context;
        return {
          explanation: { summary: 's', whyItMatters: 'w', nextStep: 'n' },
          usage: null,
        };
      },
    });
    const { app, analysisRunId } = await analyse(cookie, repositoryId, affectedFixtureFiles(), {
      explanationModel: model,
    });
    const assessment = await getAssessment(analysisRunId, INVOICE_RULE);

    await app.inject({
      method: 'POST',
      url: `/impact-assessments/${assessment.id}/explanation`,
      headers: { cookie },
    });

    // No patch attempt, no verification run and no pull request exist yet, and
    // the context says exactly that -- these are the fields the prompt forbids
    // the model from claiming anything beyond.
    expect(seen?.remediation.latestAttemptStatus).toBeNull();
    expect(seen?.verification.status).toBeNull();
    expect(seen?.verification.steps).toEqual([]);
    expect(seen?.pullRequest).toEqual({ exists: false, status: null });
    // This rule does have a registered deterministic recipe.
    expect(seen?.remediation.supported).toBe(true);

    await cleanupUser(userId);
  });
});
