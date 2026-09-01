import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class GitHubApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(`GitHub API error: ${code} (status ${status})`);
    this.name = 'GitHubApiError';
  }
}

/**
 * Raised when a repository archive download exceeds MAX_ARCHIVE_BYTES.
 * Distinct from GitHubApiError -- not an HTTP failure, a protective abort
 * of an otherwise-successful response.
 */
export class ArchiveTooLargeError extends Error {
  constructor() {
    super('repository archive exceeded the maximum allowed download size');
    this.name = 'ArchiveTooLargeError';
  }
}

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024; // 200 MB

export interface GitHubUserProfile {
  id: number;
  login: string;
  avatarUrl: string | null;
}

export interface GitHubInstallationInfo {
  id: number;
  accountType: 'User' | 'Organization';
  accountId: number;
  accountLogin: string;
}

export interface GitHubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
}

export interface GitHubClient {
  exchangeOAuthCode: (params: {
    clientId: string;
    clientSecret: string;
    code: string;
  }) => Promise<string>;
  getAuthenticatedUser: (userAccessToken: string) => Promise<GitHubUserProfile>;
  getInstallation: (installationId: number, appToken: string) => Promise<GitHubInstallationInfo>;
  listInstallationRepositories: (installationToken: string) => Promise<GitHubRepository[]>;
  getBranchCommitSha: (
    owner: string,
    name: string,
    branch: string,
    installationToken: string,
  ) => Promise<string>;
  downloadRepositoryArchive: (
    owner: string,
    name: string,
    commitSha: string,
    installationToken: string,
    destinationPath: string,
  ) => Promise<void>;
}

const MAX_REPOSITORY_PAGES = 50;
const REPOSITORIES_PER_PAGE = 100;

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Thin wrapper over the GitHub REST/OAuth HTTP boundary. Accepts an
 * injectable fetch implementation so tests can fake GitHub's responses
 * without making real network calls or mocking our own logic.
 */
export function createGitHubClient(fetchImpl: typeof fetch = fetch): GitHubClient {
  async function exchangeOAuthCode(params: {
    clientId: string;
    clientSecret: string;
    code: string;
  }): Promise<string> {
    const response = await fetchImpl('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
      }),
    });
    if (!response.ok) throw new GitHubApiError('oauth_exchange_failed', response.status);

    const data = (await response.json()) as { access_token?: string; error?: string };
    if (!data.access_token)
      throw new GitHubApiError(data.error ?? 'oauth_exchange_failed', response.status);
    return data.access_token;
  }

  async function getAuthenticatedUser(userAccessToken: string): Promise<GitHubUserProfile> {
    const response = await fetchImpl('https://api.github.com/user', {
      headers: authHeaders(userAccessToken),
    });
    if (!response.ok) throw new GitHubApiError('get_authenticated_user_failed', response.status);

    const data = (await response.json()) as {
      id: number;
      login: string;
      avatar_url: string | null;
    };
    return { id: data.id, login: data.login, avatarUrl: data.avatar_url };
  }

  async function getInstallation(
    installationId: number,
    appToken: string,
  ): Promise<GitHubInstallationInfo> {
    const response = await fetchImpl(`https://api.github.com/app/installations/${installationId}`, {
      headers: authHeaders(appToken),
    });
    if (!response.ok) throw new GitHubApiError('get_installation_failed', response.status);

    const data = (await response.json()) as {
      id: number;
      account: { id: number; login: string; type: string } | null;
    };
    if (!data.account) throw new GitHubApiError('installation_missing_account', response.status);

    return {
      id: data.id,
      accountType: data.account.type === 'Organization' ? 'Organization' : 'User',
      accountId: data.account.id,
      accountLogin: data.account.login,
    };
  }

  async function listInstallationRepositories(
    installationToken: string,
  ): Promise<GitHubRepository[]> {
    const repositories: GitHubRepository[] = [];

    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
      const response = await fetchImpl(
        `https://api.github.com/installation/repositories?per_page=${REPOSITORIES_PER_PAGE}&page=${page}`,
        { headers: authHeaders(installationToken) },
      );
      if (!response.ok)
        throw new GitHubApiError('list_installation_repositories_failed', response.status);

      const data = (await response.json()) as {
        repositories: Array<{
          id: number;
          owner: { login: string };
          name: string;
          full_name: string;
          private: boolean;
          default_branch: string;
        }>;
      };

      for (const repo of data.repositories) {
        repositories.push({
          id: repo.id,
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
          isPrivate: repo.private,
          defaultBranch: repo.default_branch,
        });
      }

      if (data.repositories.length < REPOSITORIES_PER_PAGE) break;
    }

    return repositories;
  }

  async function getBranchCommitSha(
    owner: string,
    name: string,
    branch: string,
    installationToken: string,
  ): Promise<string> {
    const response = await fetchImpl(
      `https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(branch)}`,
      { headers: authHeaders(installationToken) },
    );
    if (!response.ok) throw new GitHubApiError('get_branch_commit_sha_failed', response.status);

    const data = (await response.json()) as { sha?: string };
    if (!data.sha) throw new GitHubApiError('branch_commit_sha_missing', response.status);
    return data.sha;
  }

  /**
   * Downloads the tarball archive of a repository at an exact commit SHA
   * (never a branch/ref pointer) to destinationPath, streaming to disk
   * rather than buffering in memory. GitHub's tarball endpoint redirects
   * to a signed codeload.github.com URL; fetch follows this automatically,
   * and the redirect target needs no Authorization header (the signed URL
   * itself is the credential). Aborts and removes the partial file if the
   * download exceeds MAX_ARCHIVE_BYTES, regardless of what (or whether)
   * Content-Length claims.
   */
  async function downloadRepositoryArchive(
    owner: string,
    name: string,
    commitSha: string,
    installationToken: string,
    destinationPath: string,
  ): Promise<void> {
    const response = await fetchImpl(
      `https://api.github.com/repos/${owner}/${name}/tarball/${encodeURIComponent(commitSha)}`,
      { headers: authHeaders(installationToken) },
    );
    if (!response.ok || !response.body) {
      throw new GitHubApiError('download_repository_archive_failed', response.status);
    }

    let bytesRead = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesRead += chunk.length;
        if (bytesRead > MAX_ARCHIVE_BYTES) {
          callback(new ArchiveTooLargeError());
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
        limiter,
        createWriteStream(destinationPath),
      );
    } catch (error) {
      await rm(destinationPath, { force: true });
      throw error;
    }
  }

  return {
    exchangeOAuthCode,
    getAuthenticatedUser,
    getInstallation,
    listInstallationRepositories,
    getBranchCommitSha,
    downloadRepositoryArchive,
  };
}
