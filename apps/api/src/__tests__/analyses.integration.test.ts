import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadEnv } from '@patchwork/config';
import { createDbClient, schema, type DbClient } from '@patchwork/db';
import { buildApp } from '../app.js';
import { createSession } from '../auth/sessions.js';
import { findOrCreateUserByGitHubProfile } from '../auth/users.js';
import type { GitHubInstallationInfo, GitHubRepository } from '@patchwork/github';
import { upsertInstallationAndRepositories } from '../github/persistence.js';
import {
  fakeGitHubAppAuth,
  fakeGitHubClient,
  fakeGitHubClientWithArchive,
  testAppDeps,
  uniqueGithubId,
} from './fixtures.js';

// Requires a reachable, migrated PostgreSQL instance (see docs/testing.md).
// Each test uses unique GitHub ids and cleans up exactly the rows it created.
describe('repository analyses (real database)', () => {
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

  // Installations reference the connecting user with ON DELETE RESTRICT, so
  // installations/repositories (cascaded, which also cascades snapshots) and
  // analysis_runs must be deleted before the user.
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

  async function connectRepository(
    userId: string,
    overrides: Partial<GitHubRepository> = {},
  ): Promise<{ repositoryId: string }> {
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
      ...overrides,
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

  it('returns 401 without a session', async () => {
    const app = buildApp(testAppDeps({ db }));
    const response = await app.inject({
      method: 'POST',
      url: `/repositories/${crypto.randomUUID()}/analyses`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 404 for a repository that does not exist', async () => {
    const app = buildApp(testAppDeps({ db }));
    const { cookie, userId } = await createAuthenticatedUser();

    const response = await app.inject({
      method: 'POST',
      url: `/repositories/${crypto.randomUUID()}/analyses`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(404);
    await cleanupUser(userId);
  });

  it('returns 404 for a repository connected by a different user, without leaking its existence', async () => {
    const app = buildApp(testAppDeps({ db }));
    const { userId: ownerId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(ownerId);
    const { cookie: otherCookie, userId: otherUserId } = await createAuthenticatedUser();

    const response = await app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/analyses`,
      headers: { cookie: otherCookie },
    });

    expect(response.statusCode).toBe(404);
    await cleanupUser(otherUserId);
    await cleanupUser(ownerId);
  });

  it('resolves the commit SHA and creates a snapshot + run for a valid, owned repository', async () => {
    const githubClient = fakeGitHubClientWithArchive(
      { 'package.json': JSON.stringify({ dependencies: { express: '^5.0.0' } }) },
      { getBranchCommitSha: async () => 'a'.repeat(40) },
    );
    const app = buildApp(testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth() }));
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);

    const response = await app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/analyses`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      snapshot: { id: string; commitSha: string; ref: string };
      analysisRun: { id: string; status: string; analyzerVersion: string };
      evidence: { installedSdks: unknown[] } | null;
    };
    expect(body.snapshot.commitSha).toBe('a'.repeat(40));
    expect(body.snapshot.ref).toBe('main');
    expect(body.analysisRun.status).toBe('completed');
    expect(body.analysisRun.analyzerVersion).toBe('v1');
    expect(body.evidence?.installedSdks).toEqual([]); // no stripe dependency in the fixture

    const snapshots = await db.db
      .select()
      .from(schema.repositorySnapshots)
      .where(eq(schema.repositorySnapshots.repositoryId, repositoryId));
    expect(snapshots).toHaveLength(1);

    const runs = await db.db
      .select()
      .from(schema.analysisRuns)
      .where(eq(schema.analysisRuns.repositorySnapshotId, snapshots[0]!.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.triggeredByUserId).toBe(userId);

    const evidenceRows = await db.db
      .select()
      .from(schema.analysisEvidence)
      .where(eq(schema.analysisEvidence.analysisRunId, runs[0]!.id));
    expect(evidenceRows).toHaveLength(1);

    await cleanupUser(userId);
  });

  it('persists Stripe evidence when the fixture archive declares a stripe dependency', async () => {
    const githubClient = fakeGitHubClientWithArchive(
      {
        'package.json': JSON.stringify({ dependencies: { stripe: '^17.0.0' } }),
        'package-lock.json': JSON.stringify({
          packages: { '': {}, 'node_modules/stripe': { version: '17.4.0' } },
        }),
        'src/stripe.ts': [
          "import Stripe from 'stripe';",
          'const stripe = new Stripe(secretKey, { apiVersion: "2025-01-27.acacia" });',
        ].join('\n'),
      },
      { getBranchCommitSha: async () => 'e'.repeat(40) },
    );
    const app = buildApp(testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth() }));
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);

    const response = await app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/analyses`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      analysisRun: { id: string };
      evidence: {
        installedSdks: { resolvedVersion: string; resolutionStatus: string }[];
        clientVersions: { apiVersion: string; valueKind: string }[];
      };
    };
    expect(body.evidence.installedSdks).toEqual([
      expect.objectContaining({ resolvedVersion: '17.4.0', resolutionStatus: 'EXACT' }),
    ]);
    expect(body.evidence.clientVersions).toEqual([
      expect.objectContaining({ apiVersion: '2025-01-27.acacia', valueKind: 'LITERAL' }),
    ]);

    const evidenceRows = await db.db
      .select()
      .from(schema.analysisEvidence)
      .where(eq(schema.analysisEvidence.analysisRunId, body.analysisRun.id));
    expect(evidenceRows).toHaveLength(1);
    expect(evidenceRows[0]!.schemaVersion).toBe(1);

    await cleanupUser(userId);
  });

  it('records a failed AnalysisRun with no evidence row when archive acquisition fails, without discarding the already-recorded snapshot', async () => {
    const githubClient = fakeGitHubClient({
      getBranchCommitSha: async () => 'f'.repeat(40),
      downloadRepositoryArchive: async () => {
        throw new Error('archive download failed');
      },
    });
    const app = buildApp(testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth() }));
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);

    const response = await app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/analyses`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      analysisRun: { id: string; status: string };
      evidence: unknown;
    };
    expect(body.analysisRun.status).toBe('failed');
    expect(body.evidence).toBeNull();

    const snapshots = await db.db
      .select()
      .from(schema.repositorySnapshots)
      .where(eq(schema.repositorySnapshots.repositoryId, repositoryId));
    expect(snapshots).toHaveLength(1); // the snapshot itself is still valid and recorded

    const evidenceRows = await db.db
      .select()
      .from(schema.analysisEvidence)
      .where(eq(schema.analysisEvidence.analysisRunId, body.analysisRun.id));
    expect(evidenceRows).toHaveLength(0);

    await cleanupUser(userId);
  });

  it('fails closed with no writes when GitHub SHA resolution fails', async () => {
    const githubClient = fakeGitHubClient({
      getBranchCommitSha: async () => {
        throw new Error('github is down');
      },
    });
    const app = buildApp(testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth() }));
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);

    const response = await app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/analyses`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(502);

    const snapshots = await db.db
      .select()
      .from(schema.repositorySnapshots)
      .where(eq(schema.repositorySnapshots.repositoryId, repositoryId));
    expect(snapshots).toHaveLength(0);

    await cleanupUser(userId);
  });

  it('is idempotent on the snapshot: two triggers against an unchanged commit converge to one snapshot but two runs, each with its own evidence row', async () => {
    const githubClient = fakeGitHubClientWithArchive(
      { 'package.json': '{}' },
      { getBranchCommitSha: async () => 'b'.repeat(40) },
    );
    const app = buildApp(testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth() }));
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: `/repositories/${repositoryId}/analyses`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(201);
    }

    const snapshots = await db.db
      .select()
      .from(schema.repositorySnapshots)
      .where(eq(schema.repositorySnapshots.repositoryId, repositoryId));
    expect(snapshots).toHaveLength(1);

    const runs = await db.db
      .select()
      .from(schema.analysisRuns)
      .where(eq(schema.analysisRuns.repositorySnapshotId, snapshots[0]!.id));
    expect(runs).toHaveLength(2);

    for (const run of runs) {
      const evidenceRows = await db.db
        .select()
        .from(schema.analysisEvidence)
        .where(eq(schema.analysisEvidence.analysisRunId, run.id));
      expect(evidenceRows).toHaveLength(1);
    }

    await cleanupUser(userId);
  });

  it('reports the latest analysis (including a condensed stripe summary) on GET /repositories after triggering one', async () => {
    const githubClient = fakeGitHubClientWithArchive(
      { 'package.json': JSON.stringify({ dependencies: { stripe: '^17.0.0' } }) },
      { getBranchCommitSha: async () => 'c'.repeat(40) },
    );
    const app = buildApp(testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth() }));
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);

    await app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/analyses`,
      headers: { cookie },
    });

    const list = await app.inject({ method: 'GET', url: '/repositories', headers: { cookie } });
    const body = list.json() as {
      repositories: {
        id: string;
        latestAnalysis: {
          commitSha: string;
          status: string;
          stripe: { resolvedVersion: string | null; declaredRange: string } | null;
        } | null;
      }[];
    };
    const repo = body.repositories.find((r) => r.id === repositoryId);
    expect(repo?.latestAnalysis).toEqual({
      analysisRunId: expect.any(String),
      commitSha: 'c'.repeat(40),
      status: 'completed',
      startedAt: expect.any(String),
      completedAt: expect.any(String),
      stripe: { resolvedVersion: null, declaredRange: '^17.0.0', workspacePath: '' },
      latestImpactAssessments: [],
    });

    await cleanupUser(userId);
  });

  it('cascades: deleting a repository deletes its snapshots (analysis_runs blocks deletion of the snapshot directly)', async () => {
    const githubClient = fakeGitHubClient({
      getBranchCommitSha: async () => 'd'.repeat(40),
    });
    const app = buildApp(testAppDeps({ db, githubClient, githubAppAuth: fakeGitHubAppAuth() }));
    const { cookie, userId } = await createAuthenticatedUser();
    const { repositoryId } = await connectRepository(userId);

    await app.inject({
      method: 'POST',
      url: `/repositories/${repositoryId}/analyses`,
      headers: { cookie },
    });

    const [snapshot] = await db.db
      .select()
      .from(schema.repositorySnapshots)
      .where(eq(schema.repositorySnapshots.repositoryId, repositoryId));
    expect(snapshot).toBeDefined();

    // analysis_runs references the snapshot ON DELETE RESTRICT -- deleting
    // the run first is required before the cascade from repository deletion
    // can remove the snapshot.
    await db.db
      .delete(schema.analysisRuns)
      .where(eq(schema.analysisRuns.repositorySnapshotId, snapshot!.id));
    await db.db.delete(schema.repositories).where(eq(schema.repositories.id, repositoryId));

    const remaining = await db.db
      .select()
      .from(schema.repositorySnapshots)
      .where(eq(schema.repositorySnapshots.repositoryId, repositoryId));
    expect(remaining).toHaveLength(0);

    await cleanupUser(userId);
  });
});
