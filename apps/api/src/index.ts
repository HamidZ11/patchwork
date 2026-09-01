import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { loadEnv } from '@patchwork/config';
import { createDbClient } from '@patchwork/db';
import { buildApp } from './app.js';
import { loadApiConfig } from './config.js';
import { createGitHubAppAuth, createGitHubClient } from '@patchwork/github';
import { resolveCookiePolicy } from './plugins/cookies.js';

// Local dev only -- in production, real environment variables are injected
// by the platform and this is a no-op (no .env file present).
loadDotenv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env'),
});

const env = loadEnv();
const apiConfig = loadApiConfig();
const db = createDbClient(env.DATABASE_URL);

const app = buildApp({
  db,
  logLevel: env.LOG_LEVEL,
  githubClient: createGitHubClient(),
  githubAppAuth: createGitHubAppAuth({
    appId: apiConfig.github.appId,
    privateKey: apiConfig.github.privateKey,
    clientId: apiConfig.github.clientId,
    clientSecret: apiConfig.github.clientSecret,
  }),
  githubClientId: apiConfig.github.clientId,
  githubClientSecret: apiConfig.github.clientSecret,
  githubAppSlug: apiConfig.github.appSlug,
  cookiePolicy: resolveCookiePolicy(env.NODE_ENV, apiConfig.sessionCookieDomain),
  webAppUrl: apiConfig.webAppUrl,
});

async function start(): Promise<void> {
  try {
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error({ err: error }, 'failed to start server');
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.close();
  app.log.info('shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void start();
