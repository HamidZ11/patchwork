import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import { getUserById, type PatchworkUser } from './users.js';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Creates a session and returns the raw token — the only moment it exists
 * outside the browser's cookie. Only its SHA-256 hash is persisted, so a
 * database read alone can never yield a usable session.
 */
export async function createSession(
  db: Database,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.insert(schema.sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
  });

  return { token, expiresAt };
}

export async function getSessionUser(db: Database, token: string): Promise<PatchworkUser | null> {
  const [session] = await db
    .select({ userId: schema.sessions.userId })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.tokenHash, hashToken(token)),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session) return null;
  return getUserById(db, session.userId);
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
}
