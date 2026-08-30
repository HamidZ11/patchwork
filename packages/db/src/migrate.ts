import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '@patchwork/config';
import { createDbClient } from './client.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsFolder = path.join(packageRoot, 'migrations');

loadDotenv({ path: path.resolve(packageRoot, '..', '..', '.env') });

async function main(): Promise<void> {
  const env = loadEnv();
  const client = createDbClient(env.DATABASE_URL);

  try {
    await migrate(client.db, { migrationsFolder });
    console.log('Migrations applied successfully.');
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
