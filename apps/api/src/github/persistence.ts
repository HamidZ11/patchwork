import { eq } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import type { GitHubInstallationInfo, GitHubRepository } from '@patchwork/github';

export interface StoredRepository {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
}

/**
 * Idempotently persists a validated installation and the repositories it
 * currently has access to, in one transaction. If the installation already
 * exists, its connected_by_user_id is deliberately NOT reassigned — "first
 * connector wins" (see packages/db/src/schema.ts and
 * docs/github-integration.md for why).
 */
export async function upsertInstallationAndRepositories(
  db: Database,
  params: {
    installation: GitHubInstallationInfo;
    repositories: GitHubRepository[];
    connectedByUserId: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [installationRow] = await tx
      .insert(schema.githubInstallations)
      .values({
        githubInstallationId: params.installation.id,
        accountType: params.installation.accountType,
        accountId: params.installation.accountId,
        accountLogin: params.installation.accountLogin,
        connectedByUserId: params.connectedByUserId,
      })
      .onConflictDoUpdate({
        target: schema.githubInstallations.githubInstallationId,
        set: {
          accountType: params.installation.accountType,
          accountId: params.installation.accountId,
          accountLogin: params.installation.accountLogin,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.githubInstallations.id });

    if (!installationRow) throw new Error('failed to upsert installation');

    for (const repo of params.repositories) {
      await tx
        .insert(schema.repositories)
        .values({
          githubRepositoryId: repo.id,
          installationId: installationRow.id,
          owner: repo.owner,
          name: repo.name,
          fullName: repo.fullName,
          isPrivate: repo.isPrivate,
          defaultBranch: repo.defaultBranch,
        })
        .onConflictDoUpdate({
          target: schema.repositories.githubRepositoryId,
          set: {
            installationId: installationRow.id,
            owner: repo.owner,
            name: repo.name,
            fullName: repo.fullName,
            isPrivate: repo.isPrivate,
            defaultBranch: repo.defaultBranch,
            updatedAt: new Date(),
          },
        });
    }
  });
}

export async function getRepositoriesForUser(
  db: Database,
  userId: string,
): Promise<StoredRepository[]> {
  return db
    .select({
      id: schema.repositories.id,
      owner: schema.repositories.owner,
      name: schema.repositories.name,
      fullName: schema.repositories.fullName,
      isPrivate: schema.repositories.isPrivate,
      defaultBranch: schema.repositories.defaultBranch,
    })
    .from(schema.repositories)
    .innerJoin(
      schema.githubInstallations,
      eq(schema.repositories.installationId, schema.githubInstallations.id),
    )
    .where(eq(schema.githubInstallations.connectedByUserId, userId));
}
