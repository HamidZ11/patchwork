import { createAppAuth } from '@octokit/auth-app';

export interface GitHubAppAuthConfig {
  appId: number;
  privateKey: string;
  clientId: string;
  clientSecret: string;
}

export interface GitHubAppAuth {
  getAppToken: () => Promise<string>;
  getInstallationToken: (installationId: number) => Promise<string>;
}

/**
 * Generates short-lived GitHub App credentials on demand: an App JWT (for
 * app-level calls like validating an installation) or an installation
 * access token (for calls scoped to that installation's repositories).
 * Neither is ever cached or persisted here — callers use the returned
 * token immediately and discard it.
 */
export function createGitHubAppAuth(config: GitHubAppAuthConfig): GitHubAppAuth {
  const auth = createAppAuth({
    appId: config.appId,
    privateKey: config.privateKey,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  return {
    getAppToken: async () => {
      const result = await auth({ type: 'app' });
      return result.token;
    },
    getInstallationToken: async (installationId: number) => {
      const result = await auth({ type: 'installation', installationId });
      return result.token;
    },
  };
}
