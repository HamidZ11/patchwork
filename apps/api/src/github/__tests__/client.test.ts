import { describe, expect, it } from 'vitest';
import { createGitHubClient, GitHubApiError } from '../client.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe('listInstallationRepositories', () => {
  it('follows pagination until a short page is returned', async () => {
    const pageOne = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      owner: { login: 'octocat' },
      name: `repo-${i}`,
      full_name: `octocat/repo-${i}`,
      private: false,
      default_branch: 'main',
    }));
    const pageTwo = [
      {
        id: 999,
        owner: { login: 'octocat' },
        name: 'last-repo',
        full_name: 'octocat/last-repo',
        private: true,
        default_branch: 'main',
      },
    ];

    const requestedPages: number[] = [];
    const fetchImpl = (async (url: string | URL) => {
      const parsed = new URL(url.toString());
      const page = Number(parsed.searchParams.get('page'));
      requestedPages.push(page);
      return jsonResponse({ repositories: page === 1 ? pageOne : pageTwo });
    }) as typeof fetch;

    const client = createGitHubClient(fetchImpl);
    const repositories = await client.listInstallationRepositories('fake-token');

    expect(requestedPages).toEqual([1, 2]);
    expect(repositories).toHaveLength(101);
    expect(repositories[100]).toEqual({
      id: 999,
      owner: 'octocat',
      name: 'last-repo',
      fullName: 'octocat/last-repo',
      isPrivate: true,
      defaultBranch: 'main',
    });
  });

  it('does not paginate further when the first page is short', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        repositories: [
          {
            id: 1,
            owner: { login: 'octocat' },
            name: 'only-repo',
            full_name: 'octocat/only-repo',
            private: false,
            default_branch: 'main',
          },
        ],
      })) as typeof fetch;
    let callCount = 0;
    const countingFetch = (async (...args: Parameters<typeof fetch>) => {
      callCount += 1;
      return fetchImpl(...args);
    }) as typeof fetch;

    const client = createGitHubClient(countingFetch);
    const repositories = await client.listInstallationRepositories('fake-token');

    expect(callCount).toBe(1);
    expect(repositories).toHaveLength(1);
  });

  it('throws a GitHubApiError when GitHub responds with a failure status', async () => {
    const fetchImpl = (async () => jsonResponse({}, false, 401)) as typeof fetch;
    const client = createGitHubClient(fetchImpl);

    await expect(client.listInstallationRepositories('bad-token')).rejects.toBeInstanceOf(
      GitHubApiError,
    );
  });
});

describe('getInstallation', () => {
  it('maps GitHub account.type to our accountType union', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        id: 55,
        account: { id: 7, login: 'acme', type: 'Organization' },
      })) as typeof fetch;
    const client = createGitHubClient(fetchImpl);

    const installation = await client.getInstallation(55, 'app-token');

    expect(installation).toEqual({
      id: 55,
      accountType: 'Organization',
      accountId: 7,
      accountLogin: 'acme',
    });
  });

  it('throws when the installation has no account (should never happen, fail closed)', async () => {
    const fetchImpl = (async () => jsonResponse({ id: 55, account: null })) as typeof fetch;
    const client = createGitHubClient(fetchImpl);

    await expect(client.getInstallation(55, 'app-token')).rejects.toBeInstanceOf(GitHubApiError);
  });
});
