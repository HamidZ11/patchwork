import { z } from 'zod';

const apiEnvSchema = z.object({
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_SLUG: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_PRIVATE_KEY_BASE64: z.string().min(1),
  SESSION_COOKIE_DOMAIN: z.string().min(1).optional(),
  WEB_APP_URL: z.string().url(),
});

export interface ApiConfig {
  github: {
    appId: number;
    appSlug: string;
    clientId: string;
    clientSecret: string;
    privateKey: string;
  };
  sessionCookieDomain: string | undefined;
  webAppUrl: string;
}

/**
 * Parses and validates the GitHub App / session configuration specific to
 * apps/api, failing fast with a readable error if invalid. Separate from
 * @patchwork/config's shared env schema because these values are only
 * needed by apps/api — apps/worker has no reason to hold GitHub credentials
 * for this slice.
 */
export function loadApiConfig(source: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = apiEnvSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid API configuration:\n${issues}`);
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
    sessionCookieDomain: env.SESSION_COOKIE_DOMAIN,
    webAppUrl: env.WEB_APP_URL,
  };
}
