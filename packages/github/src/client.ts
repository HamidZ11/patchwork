import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class GitHubApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    /** GitHub's own response `message` field, when available -- short, never a customer secret, safe to persist/surface (e.g. distinguishing a ruleset rejection from a generic validation error on a 422). */
    public readonly details?: string,
    /** Parsed from the response's `Retry-After` header, when present -- GitHub's secondary rate limit responses include this; callers should not retry before this many seconds have elapsed. */
    public readonly retryAfterSeconds?: number,
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

export interface GitHubTreeEntry {
  path: string;
  blobSha: string;
}

export interface GitHubCommitAuthor {
  name: string;
  email: string;
}

export interface GitHubPullRequestSummary {
  number: number;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
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
  /** The Git tree SHA a commit points at -- used as `base_tree` so a new tree only needs entries for changed files. */
  getCommitTreeSha: (
    owner: string,
    name: string,
    commitSha: string,
    installationToken: string,
  ) => Promise<string>;
  /** Creates a blob from exact file content (never derived from mutable HEAD) and returns its SHA. */
  createBlob: (
    owner: string,
    name: string,
    contentBase64: string,
    installationToken: string,
  ) => Promise<string>;
  /** Creates a new tree layered on `baseTreeSha`, containing only the changed-file entries; returns the new tree's SHA. */
  createTree: (
    owner: string,
    name: string,
    baseTreeSha: string,
    entries: GitHubTreeEntry[],
    installationToken: string,
  ) => Promise<string>;
  /** Creates a commit object (not yet reachable from any ref) and returns its SHA. */
  createCommit: (
    owner: string,
    name: string,
    params: { message: string; treeSha: string; parentShas: string[]; author: GitHubCommitAuthor },
    installationToken: string,
  ) => Promise<string>;
  /** The tip commit SHA of `refs/heads/{branch}`, or null if that branch doesn't exist -- a 404 here is an expected, normal outcome, never an error. */
  getBranchRefSha: (
    owner: string,
    name: string,
    branch: string,
    installationToken: string,
  ) => Promise<string | null>;
  /** Creates a brand-new branch ref. No force/update variant is exposed anywhere on this client -- an existing ref of the same name always fails (surfaced as GitHubApiError), never silently overwritten. */
  createBranchRef: (
    owner: string,
    name: string,
    branch: string,
    commitSha: string,
    installationToken: string,
  ) => Promise<void>;
  createPullRequest: (
    owner: string,
    name: string,
    params: { title: string; body: string; head: string; base: string },
    installationToken: string,
  ) => Promise<GitHubPullRequestSummary>;
  getPullRequest: (
    owner: string,
    name: string,
    number: number,
    installationToken: string,
  ) => Promise<GitHubPullRequestSummary>;
  /** Open PRs whose head is exactly `{owner}:{branch}` on this repository -- a defense-in-depth duplicate check alongside persisted state, never the primary mechanism. */
  listOpenPullRequestsForHead: (
    owner: string,
    name: string,
    branch: string,
    installationToken: string,
  ) => Promise<GitHubPullRequestSummary[]>;
  /**
   * Resolves the numeric user id of the App's own bot machine-user
   * account (`<app-slug>[bot]`) -- public metadata, stable per App,
   * meant to be resolved once and cached, not fetched per commit.
   * Deliberately unauthenticated: `GET /users/{username}` is a public
   * REST endpoint (confirmed live), and App JWTs -- the only credential
   * this App-global lookup could otherwise use, since it isn't scoped to
   * any one installation -- aren't valid bearer tokens for general REST
   * endpoints in the first place (only for the small set of `/app/*`
   * management endpoints), so passing one here would fail with 401
   * "Bad credentials", not a permissions error.
   */
  getBotUserId: (appSlug: string) => Promise<number>;
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

  /** Best-effort extraction of GitHub's own `message` field from an error response body -- never throws, since this is only used to enrich an error we're already raising. */
  async function errorDetails(response: Response): Promise<string | undefined> {
    try {
      const data = (await response.clone().json()) as { message?: string };
      return data.message;
    } catch {
      return undefined;
    }
  }

  /** Builds a GitHubApiError carrying both the response body's `message` and a parsed `Retry-After` header, when present -- the single place both are extracted, for the write-path methods that need rate-limit/ruleset classification. */
  async function apiError(code: string, response: Response): Promise<GitHubApiError> {
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
    return new GitHubApiError(
      code,
      response.status,
      await errorDetails(response),
      Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
    );
  }

  async function getCommitTreeSha(
    owner: string,
    name: string,
    commitSha: string,
    installationToken: string,
  ): Promise<string> {
    const response = await fetchImpl(
      `https://api.github.com/repos/${owner}/${name}/git/commits/${encodeURIComponent(commitSha)}`,
      { headers: authHeaders(installationToken) },
    );
    if (!response.ok) {
      throw await apiError('get_commit_tree_sha_failed', response);
    }
    const data = (await response.json()) as { tree?: { sha?: string } };
    if (!data.tree?.sha) throw new GitHubApiError('commit_tree_sha_missing', response.status);
    return data.tree.sha;
  }

  async function createBlob(
    owner: string,
    name: string,
    contentBase64: string,
    installationToken: string,
  ): Promise<string> {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${name}/git/blobs`, {
      method: 'POST',
      headers: { ...authHeaders(installationToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: contentBase64, encoding: 'base64' }),
    });
    if (!response.ok) {
      throw await apiError('create_blob_failed', response);
    }
    const data = (await response.json()) as { sha?: string };
    if (!data.sha) throw new GitHubApiError('blob_sha_missing', response.status);
    return data.sha;
  }

  async function createTree(
    owner: string,
    name: string,
    baseTreeSha: string,
    entries: GitHubTreeEntry[],
    installationToken: string,
  ): Promise<string> {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${name}/git/trees`, {
      method: 'POST',
      headers: { ...authHeaders(installationToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: entries.map((entry) => ({
          path: entry.path,
          mode: '100644',
          type: 'blob',
          sha: entry.blobSha,
        })),
      }),
    });
    if (!response.ok) {
      throw await apiError('create_tree_failed', response);
    }
    const data = (await response.json()) as { sha?: string };
    if (!data.sha) throw new GitHubApiError('tree_sha_missing', response.status);
    return data.sha;
  }

  async function createCommit(
    owner: string,
    name: string,
    params: { message: string; treeSha: string; parentShas: string[]; author: GitHubCommitAuthor },
    installationToken: string,
  ): Promise<string> {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${name}/git/commits`, {
      method: 'POST',
      headers: { ...authHeaders(installationToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: params.message,
        tree: params.treeSha,
        parents: params.parentShas,
        author: params.author,
        committer: params.author,
      }),
    });
    if (!response.ok) {
      throw await apiError('create_commit_failed', response);
    }
    const data = (await response.json()) as { sha?: string };
    if (!data.sha) throw new GitHubApiError('commit_sha_missing', response.status);
    return data.sha;
  }

  async function getBranchRefSha(
    owner: string,
    name: string,
    branch: string,
    installationToken: string,
  ): Promise<string | null> {
    const response = await fetchImpl(
      `https://api.github.com/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branch)}`,
      { headers: authHeaders(installationToken) },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw await apiError('get_branch_ref_failed', response);
    }
    const data = (await response.json()) as { object?: { sha?: string } };
    if (!data.object?.sha) throw new GitHubApiError('branch_ref_sha_missing', response.status);
    return data.object.sha;
  }

  async function createBranchRef(
    owner: string,
    name: string,
    branch: string,
    commitSha: string,
    installationToken: string,
  ): Promise<void> {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${name}/git/refs`, {
      method: 'POST',
      headers: { ...authHeaders(installationToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
    });
    if (!response.ok) {
      throw await apiError('create_branch_ref_failed', response);
    }
  }

  function toPullRequestSummary(data: {
    number: number;
    html_url: string;
    state: string;
    merged?: boolean;
  }): GitHubPullRequestSummary {
    return {
      number: data.number,
      url: data.html_url,
      state: data.state === 'closed' ? 'closed' : 'open',
      merged: data.merged ?? false,
    };
  }

  async function createPullRequest(
    owner: string,
    name: string,
    params: { title: string; body: string; head: string; base: string },
    installationToken: string,
  ): Promise<GitHubPullRequestSummary> {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${name}/pulls`, {
      method: 'POST',
      headers: { ...authHeaders(installationToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
      }),
    });
    if (!response.ok) {
      throw await apiError('create_pull_request_failed', response);
    }
    return toPullRequestSummary(
      (await response.json()) as {
        number: number;
        html_url: string;
        state: string;
        merged?: boolean;
      },
    );
  }

  async function getPullRequest(
    owner: string,
    name: string,
    number: number,
    installationToken: string,
  ): Promise<GitHubPullRequestSummary> {
    const response = await fetchImpl(
      `https://api.github.com/repos/${owner}/${name}/pulls/${number}`,
      { headers: authHeaders(installationToken) },
    );
    if (!response.ok) {
      throw await apiError('get_pull_request_failed', response);
    }
    return toPullRequestSummary(
      (await response.json()) as {
        number: number;
        html_url: string;
        state: string;
        merged?: boolean;
      },
    );
  }

  async function listOpenPullRequestsForHead(
    owner: string,
    name: string,
    branch: string,
    installationToken: string,
  ): Promise<GitHubPullRequestSummary[]> {
    const response = await fetchImpl(
      `https://api.github.com/repos/${owner}/${name}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
      { headers: authHeaders(installationToken) },
    );
    if (!response.ok) {
      throw await apiError('list_open_pull_requests_failed', response);
    }
    const data = (await response.json()) as {
      number: number;
      html_url: string;
      state: string;
      merged?: boolean;
    }[];
    return data.map(toPullRequestSummary);
  }

  async function getBotUserId(appSlug: string): Promise<number> {
    const response = await fetchImpl(`https://api.github.com/users/${appSlug}[bot]`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) {
      throw await apiError('get_bot_user_failed', response);
    }
    const data = (await response.json()) as { id?: number };
    if (!data.id) throw new GitHubApiError('bot_user_id_missing', response.status);
    return data.id;
  }

  return {
    exchangeOAuthCode,
    getAuthenticatedUser,
    getInstallation,
    listInstallationRepositories,
    getBranchCommitSha,
    downloadRepositoryArchive,
    getCommitTreeSha,
    createBlob,
    createTree,
    createCommit,
    getBranchRefSha,
    createBranchRef,
    createPullRequest,
    getPullRequest,
    listOpenPullRequestsForHead,
    getBotUserId,
  };
}
