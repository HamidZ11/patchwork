import { eq } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import type { GitHubUserProfile } from '../github/client.js';

export interface PatchworkUser {
  id: string;
  githubLogin: string;
  avatarUrl: string | null;
}

/**
 * Upserts a User keyed on github_user_id (the identity anchor — logins are
 * mutable and are refreshed on every login instead).
 */
export async function findOrCreateUserByGitHubProfile(
  db: Database,
  profile: GitHubUserProfile,
): Promise<PatchworkUser> {
  const [user] = await db
    .insert(schema.users)
    .values({
      githubUserId: profile.id,
      githubLogin: profile.login,
      avatarUrl: profile.avatarUrl,
    })
    .onConflictDoUpdate({
      target: schema.users.githubUserId,
      set: { githubLogin: profile.login, avatarUrl: profile.avatarUrl, updatedAt: new Date() },
    })
    .returning({
      id: schema.users.id,
      githubLogin: schema.users.githubLogin,
      avatarUrl: schema.users.avatarUrl,
    });

  if (!user) throw new Error('failed to upsert user');
  return user;
}

export async function getUserById(db: Database, userId: string): Promise<PatchworkUser | null> {
  const [user] = await db
    .select({
      id: schema.users.id,
      githubLogin: schema.users.githubLogin,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  return user ?? null;
}
