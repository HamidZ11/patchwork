import { z } from 'zod';

const workerEnvSchema = z.object({
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_PRIVATE_KEY_BASE64: z.string().min(1),
  E2B_API_KEY: z.string().min(1),
});

export interface WorkerConfig {
  github: {
    appId: number;
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
 * needs GitHub App credentials for the first time in this slice --
 * verification's exact-SHA archive download requires its own short-lived
 * installation token (never persisted, never shared with apps/api's
 * process), and E2B_API_KEY exists only here: the sandbox is created and
 * destroyed entirely within apps/worker, never touched by apps/api.
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
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      privateKey: Buffer.from(env.GITHUB_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
    },
    e2bApiKey: env.E2B_API_KEY,
  };
}
