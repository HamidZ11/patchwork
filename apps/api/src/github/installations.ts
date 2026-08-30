import type { GitHubClient, GitHubInstallationInfo, GitHubRepository } from './client.js';
import type { GitHubAppAuth } from './auth.js';

export interface InstallationSyncResult {
  installation: GitHubInstallationInfo;
  repositories: GitHubRepository[];
}

/**
 * Validates an installation against GitHub (never trusting a caller-supplied
 * installation ID alone) and fetches the repositories it currently has
 * access to. Orchestration only — no DB access, no HTTP request/response
 * shaping.
 */
export async function syncInstallation(
  installationId: number,
  deps: { client: GitHubClient; appAuth: GitHubAppAuth },
): Promise<InstallationSyncResult> {
  const appToken = await deps.appAuth.getAppToken();
  const installation = await deps.client.getInstallation(installationId, appToken);

  const installationToken = await deps.appAuth.getInstallationToken(installationId);
  const repositories = await deps.client.listInstallationRepositories(installationToken);

  return { installation, repositories };
}
