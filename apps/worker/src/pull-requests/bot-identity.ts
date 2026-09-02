import type { GitHubAppAuth, GitHubClient, GitHubCommitAuthor } from '@patchwork/github';

/**
 * The GitHub App's own bot identity is the least-misleading commit
 * attribution: it visibly attributes to "<app-slug>[bot]" with the App's
 * avatar on GitHub's UI, honestly signals "a bot did this," and needs no
 * permission beyond what commit creation already requires. The numeric id
 * in the noreply email is the bot machine-user's own user id -- a
 * different id space than the App's own numeric App ID -- resolved via
 * `GET /users/{app-slug}[bot]`.
 *
 * Public, stable-per-App metadata, not a secret: resolved once (lazily,
 * on first use) and cached in memory for the life of the process, never
 * re-fetched per commit. Concurrent first-callers share one in-flight
 * resolution rather than each issuing their own request.
 */
let cached: { appSlug: string; author: GitHubCommitAuthor } | null = null;
let inFlight: Promise<GitHubCommitAuthor> | null = null;

export async function resolveBotIdentity(
  deps: { githubClient: GitHubClient; githubAppAuth: GitHubAppAuth },
  appSlug: string,
): Promise<GitHubCommitAuthor> {
  if (cached && cached.appSlug === appSlug) return cached.author;

  if (!inFlight) {
    inFlight = (async () => {
      const appToken = await deps.githubAppAuth.getAppToken();
      const botUserId = await deps.githubClient.getBotUserId(appSlug, appToken);
      const author: GitHubCommitAuthor = {
        name: `${appSlug}[bot]`,
        email: `${botUserId}+${appSlug}[bot]@users.noreply.github.com`,
      };
      cached = { appSlug, author };
      return author;
    })().finally(() => {
      inFlight = null;
    });
  }

  return inFlight;
}

/** Test-only: clears the in-memory cache so tests don't leak state across cases. */
export function resetBotIdentityCacheForTests(): void {
  cached = null;
  inFlight = null;
}
