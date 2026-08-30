import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import pino from 'pino';
import { loadEnv } from '@patchwork/config';
import { createDbClient } from '@patchwork/db';
import { createWorker } from './worker.js';

// Local dev only -- in production, real environment variables are injected
// by the platform and this is a no-op (no .env file present).
loadDotenv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'),
});

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL, name: 'worker' });
const db = createDbClient(env.DATABASE_URL);
const worker = createWorker({ db, logger });

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  await worker.stop();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

worker.start().catch((error: unknown) => {
  logger.error({ err: error }, 'failed to start worker');
  process.exit(1);
});
