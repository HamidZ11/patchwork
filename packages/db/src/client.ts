import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbClient {
  db: Database;
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

export function createDbClient(connectionString: string): DbClient {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  return {
    db,
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: async () => {
      await pool.end();
    },
  };
}
