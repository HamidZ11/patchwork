import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '@patchwork/config';
import { createDbClient, type DbClient } from '../client.js';
import { appMetadata } from '../schema.js';

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
);

// These tests require a reachable PostgreSQL instance (see docs/testing.md).
describe('db client (integration)', () => {
  let client: DbClient;

  beforeAll(async () => {
    const env = loadEnv();
    client = createDbClient(env.DATABASE_URL);
    await migrate(client.db, { migrationsFolder });
  });

  afterAll(async () => {
    await client.close();
  });

  it('connects to postgres', async () => {
    await expect(client.ping()).resolves.not.toThrow();
  });

  it('reads and writes rows through the app_metadata table', async () => {
    const key = `test-key-${crypto.randomUUID()}`;

    await client.db.insert(appMetadata).values({ key, value: 'test-value' });

    const rows = await client.db.select().from(appMetadata).where(eq(appMetadata.key, key));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe('test-value');

    await client.db.delete(appMetadata).where(eq(appMetadata.key, key));
  });
});
