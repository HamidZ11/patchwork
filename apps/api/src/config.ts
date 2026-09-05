import { z } from 'zod';

const apiEnvSchema = z.object({
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_SLUG: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_PRIVATE_KEY_BASE64: z.string().min(1),
  SESSION_COOKIE_DOMAIN: z.string().min(1).optional(),
  WEB_APP_URL: z.string().url(),
  /**
   * Optional, deliberately. Every other credential here is required because
   * apps/api cannot do its job without it; explanations are an optional
   * explanatory layer over facts Patchwork proves without any model at all.
   * Refusing to boot the whole API -- analysis, remediation, verification,
   * publishing -- because one explanatory feature is unconfigured would make
   * the deterministic product depend on the AI one, which is the exact
   * inversion this feature must never introduce. Absent, the endpoint
   * reports itself unavailable and nothing else changes.
   */
  OPENAI_API_KEY: z.string().min(1).optional(),
  /**
   * The explanation feature rewrites facts Patchwork has already proven into
   * plain English -- the hard reasoning already happened deterministically --
   * so it deliberately defaults to a small, cheap model rather than a
   * reasoning model. Configurable because model availability changes faster
   * than this code should; the value is also part of the explanation cache
   * key, so changing it regenerates rather than silently reusing copy written
   * by a different model.
   */
  OPENAI_EXPLANATION_MODEL: z.string().min(1).default('gpt-4o-mini'),
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
  openai: {
    apiKey: string | undefined;
    explanationModel: string;
  };
}

/**
 * Parses and validates the GitHub App / session configuration specific to
 * apps/api, failing fast with a readable error if invalid. Separate from
 * @patchwork/config's shared env schema because these values are only
 * needed by apps/api — apps/worker has no reason to hold GitHub credentials
 * for this slice. OPENAI_API_KEY lives here for the same reason: the
 * explanation endpoint is served by apps/api, and the key never leaves this
 * process (never the browser, never apps/worker, never a prompt).
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
    openai: {
      apiKey: env.OPENAI_API_KEY,
      explanationModel: env.OPENAI_EXPLANATION_MODEL,
    },
  };
}
