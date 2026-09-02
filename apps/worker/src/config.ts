import { z } from 'zod';

const workerEnvSchema = z.object({
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_SLUG: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_PRIVATE_KEY_BASE64: z.string().min(1),
  E2B_API_KEY: z.string().min(1),
});

export interface WorkerConfig {
  github: {
    appId: number;
    appSlug: string;
    clientId: string;
    clientSecret: string;
    privateKey: string;
  };
  e2bApiKey: string;
}

/**
 * Parses and validates the GitHub App / sandbox-provider configuration
 * specific to apps/worker, failing fast with a readable error if invalid.
 * Separate from apps/api's own ApiConfig (apps/config.ts) even though the
 * GitHub App fields overlap: apps/api and apps/worker are still separate
 * processes/deployables per ADR-001, each holding only the credentials it
 * needs at runtime, not a shared credential-loading module. apps/worker
 * holds its own GitHub App credentials for short-lived installation
 * tokens (never persisted, never shared with apps/api's process) --
 * verification's exact-SHA archive downloads, and now the pull-request
 * publish path's branch/commit/PR writes, both need one on demand.
 * GITHUB_APP_SLUG resolves the App's own bot identity for commit
 * attribution (see pull-requests/bot-identity.ts). E2B_API_KEY exists
 * only here: the sandbox is created and destroyed entirely within
 * apps/worker, never touched by apps/api.
 */
export function loadWorkerConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = workerEnvSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid worker configuration:\n${issues}`);
  }

  const env = result.data;

  return {
    github: {
      appId: env.GITHUB_APP_ID,
      appSlug: env.GITHUB_APP_SLUG,
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      privateKey: Buffer.from(env.GITHUB_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
    },
    e2bApiKey: env.E2B_API_KEY,
  };
}
