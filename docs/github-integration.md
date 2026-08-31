# GitHub Integration

## Current (CURRENT)

The GitHub connection flow is implemented: sign in with GitHub, install the
Patchwork GitHub App, select repositories on GitHub, return to Patchwork,
and see the connected repository. See
[docs/architecture.md](architecture.md) for the code layout and
[docs/security.md](security.md) for the threat model.

**One GitHub App, two distinct purposes** — not conflated:

- **User authorization (identity)**: the App's user-to-server OAuth flow.
  `GET /auth/github/login` → `github.com/login/oauth/authorize` →
  `GET /auth/github/callback`. Establishes _who_ is using Patchwork. The
  GitHub user access token is used once (to fetch `id`/`login`/`avatar_url`
  from `GET /user`) and discarded immediately — never persisted, never
  logged.
- **Installation (repository access)**: the App's installation flow.
  `GET /github/install` (session required) →
  `github.com/apps/<slug>/installations/new` →
  `GET /github/install/callback`. Establishes _which repositories_
  Patchwork may operate on. Independent of which user is currently
  authenticated beyond the session that initiated it.

No separate traditional OAuth App exists or is needed — GitHub Apps fully
support user-to-server OAuth for identity, so a second app type would have
been redundant complexity.

### Permissions (least privilege)

- **Repository permissions: Metadata → Read-only, Contents → Read-only.
  Nothing else.** Metadata is the mandatory baseline for any App that
  lists/sees repositories at all (repository name/owner/visibility/default
  branch). **Contents: Read-only was added for the RepositorySnapshot
  slice** — `GET /repos/{owner}/{repo}/commits/{branch}` (resolving the
  exact current commit SHA of a repository's default branch, see
  [docs/data-model.md](data-model.md)) is gated by the Contents permission
  category on GitHub's side, not Metadata, even though only a commit SHA
  (not file content) is read today. No Pull requests, Actions, Workflows,
  Administration, Issues, Secrets, or Deployments — those will be requested
  by future slices only when they actually implement functionality that
  needs them (e.g. opening a PR needs Pull requests, not requested yet).
- **Account permissions: none.** Basic identity (id, login, avatar_url) is
  available via `GET /user` with any valid user-to-server token — it's core
  OAuth identity, not a scoped capability.

**Existing installations require manual approval of this permission
change** — GitHub does not silently grant an App's newly-added permissions
to installations that already exist. After adding Contents: Read-only to
the App's settings (step 7 below):

1. GitHub will show "N installation(s) will need to approve these changes."
2. Visit `github.com/settings/installations` (or the organization
   equivalent), find the Patchwork installation, and approve the pending
   permission update — GitHub prompts for this the next time you view the
   installation there, or via a "Review request" link/email GitHub sends.
3. Until approved, `getBranchCommitSha` calls against that installation
   will fail with a GitHub API error (surfaced as `502 Bad Gateway` by
   `POST /repositories/:id/analyses`, per the fail-closed convention below)
   — this is a real manual step, not something Patchwork can complete on
   your behalf.

### Installation ↔ user authorization

The GitHub App installation flow (`/installations/new?state=...` →
Setup URL callback) is protected by a single-use `state` value bound to the
Patchwork session that initiated it (see docs/security.md). This proves the
browser completing the callback is the same one authenticated with
Patchwork; GitHub itself is the authority on whether that account/org had
permission to install. The returned `installation_id` is never trusted
directly — it is always independently re-verified via
`GET /app/installations/{id}` (App-JWT-authenticated) before any database
write.

**Explicit limitation (org installations, "first connector wins")**: a
`github_installations` row records `connected_by_user_id` — whichever
Patchwork user's callback first created it. If a _different_ user later
completes a callback for the same `github_installation_id` (e.g. two
teammates both installing on the same org), ownership is **not
reassigned** — the metadata upsert still succeeds idempotently, but the
original connector stays recorded. There is no multi-user/team access
model yet. This is intentional, not an oversight — see
[docs/data-model.md](data-model.md).

### Credentials (generate, use, discard)

Installation access tokens and App JWTs are never persisted — only the
`github_installation_id` is. Both are generated on demand via
`@octokit/auth-app` (`apps/api/src/github/auth.ts`), used immediately, and
discarded. All GitHub-specific HTTP/JWT logic is centralized in
`apps/api/src/github/` — routes (`apps/api/src/routes/github.ts`,
`routes/auth.ts`) coordinate request/response only.

## Webhooks: not implemented, and not required for this slice

Assessed and deferred. The Setup URL callback synchronously returns
`installation_id`, which is independently verified and used to
synchronously fetch the repository list — nothing about completing
"connect → see repository in Patchwork" needs an async webhook. Webhooks
would only address **staleness after the fact** (repositories
added/removed from the installation, or the App uninstalled, without going
through Patchwork again) — out of this slice's scope. No `push` or
`pull_request` subscription exists or is planned for this slice.

## Manual GitHub App setup

To run the connection flow against real GitHub, create a GitHub App once:

1. Go to **github.com/settings/apps** (personal account) or your
   organization's **Settings → Developer settings → GitHub Apps**, then
   **New GitHub App**.
2. **GitHub App name**: anything unique (e.g. `patchwork-dev-<yourname>`).
   Note the resulting URL slug (`github.com/apps/<slug>`) — that's
   `GITHUB_APP_SLUG`.
3. **Homepage URL**: `http://localhost:3000` for local dev (required field,
   not otherwise used by this slice).
4. **Callback URL** (used by the user-authorization/login flow): add
   `http://localhost:3001/auth/github/callback`, and check **"Request user
   authorization (OAuth) during installation"** is left **unchecked** — the
   two flows are deliberately kept independent (see above).
5. **Setup URL** (used by the installation flow): set to
   `http://localhost:3001/github/install/callback` and select **"Redirect
   on update"** too, so re-installs/permission updates also round-trip
   through Patchwork.
6. **Webhook**: uncheck **Active** — this slice doesn't use webhooks (see
   above). Leave the webhook secret blank.
7. **Permissions → Repository permissions**: set **Metadata** to
   **Read-only** and **Contents** to **Read-only**. Leave every other
   repository/organization/account permission as **No access**.
8. **Where can this GitHub App be installed?**: "Only on this account" is
   fine for local testing.
9. Click **Create GitHub App**.
10. On the App's settings page, note:
    - **App ID** → `GITHUB_APP_ID`
    - **Client ID** → `GITHUB_CLIENT_ID`
    - Click **Generate a new client secret** → `GITHUB_CLIENT_SECRET`
      (shown once — copy it immediately)
11. Scroll to **Private keys** → **Generate a private key**. This downloads
    a `.pem` file. Base64-encode it onto a single line and use that as
    `GITHUB_PRIVATE_KEY_BASE64`:
    ```bash
    base64 -i ~/Downloads/your-app.*.private-key.pem | tr -d '\n'
    ```
12. Fill in `.env` (copied from `.env.example`) with all of the above, plus
    `WEB_APP_URL=http://localhost:3000`.

You do **not** need to install the App on any repository yet — that happens
through Patchwork's own "Install GitHub App" button once you're signed in,
which exercises the real flow.

## RepositorySnapshot commit SHA resolution (CURRENT)

`POST /repositories/:id/analyses` calls the new `getBranchCommitSha`
method on `GitHubClient` (`apps/api/src/github/client.ts`):
`GET /repos/{owner}/{repo}/commits/{branch}`, using the repository's
already-stored `default_branch` rather than re-fetching repository
metadata first (one GitHub API call, not two). A fresh installation access
token is generated, used once, and discarded — same convention as the
install flow. **Accepted limitation**: if the default branch was renamed on
GitHub after the repository was connected, this call fails (surfaced as a
clean `502`) rather than silently resolving against the wrong branch, until
the repository is re-synced through the connect flow — not handled by this
slice. See [docs/data-model.md](data-model.md) for the resulting
`RepositorySnapshot`/`AnalysisRun` rows and their fail-closed,
no-partial-write behavior on any GitHub-boundary failure.

## Open questions

- Whether/when `installation`/`installation_repositories` webhooks are
  added to keep repository data fresh without requiring the user to
  re-run the connect flow.
- Exact permission additions for future slices (Pull requests, etc.) — will
  be scoped to what those slices actually implement.

## Deferred

Branch/PR creation and CI status checks on generated PRs require
permissions not yet requested (Pull requests, Actions/Workflows) and are
out of scope until the slices that need them. Downloading/reading actual
repository file content (beyond a commit SHA) is also deferred — Contents:
Read-only is granted, but nothing in this slice exercises content reading
yet, only commit metadata.
