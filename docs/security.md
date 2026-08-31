# Security

Patchwork's core function — reading customer source code, understanding
third-party API surfaces, and proposing code changes — makes it a
security-sensitive system by design. This document is an initial threat
model plus what's actually implemented today.

## Implemented controls (CURRENT)

- Secrets are never committed. `.env` is gitignored; `.env.example`
  documents required variables without values.
- Environment configuration is validated and parsed centrally — shared
  config in `packages/config`, `apps/api`-only config (GitHub App
  credentials, session cookie domain) in `apps/api/src/config.ts` — failing
  fast on startup if invalid, instead of reading `process.env` ad hoc.
- Structured logging (pino) never logs full environment/config objects,
  only specific fields, and never logs GitHub credentials (user access
  tokens, installation tokens, the App private key) — see "Credential
  handling" below.
- Dependencies are pinned via `pnpm-lock.yaml`.
- `GET /health` and `GET /ready` return no sensitive information.

### Authentication & sessions

- Sessions are DB-backed and opaque: a random 256-bit token
  (`crypto.randomBytes(32)`) is sent to the browser in an `HttpOnly`,
  `SameSite=Lax`, `Secure`-in-production cookie; only its SHA-256 hash is
  persisted (`sessions.token_hash`), so a database read alone can never
  yield a usable session. See ADR-002 for why DB-backed over a stateless
  signed cookie (revocable, no new signing dependency).
- GitHub identity (`GET /auth/github/login` → callback) and GitHub App
  installation (`GET /github/install` → callback) are both protected by a
  `state` value: `crypto.randomBytes(32)`, stored server-side via a
  short-lived (~10 min) HttpOnly cookie, compared with
  `crypto.timingSafeEqual`, and **cleared on first successful use** —
  single-use, not just time-boxed.
  - **Documented limitation**: clearing relies on the browser honoring the
    `Set-Cookie` response and not resending the old cookie value. A client
    that deliberately resends the exact same (still-valid-length) cookie
    bypasses this. The primary protection against state leakage (via
    URL/Referer/browser history) is that an attacker who only has the
    leaked `state` value — not the HttpOnly cookie, which never left the
    legitimate browser — cannot complete the callback at all, since
    validation requires both to match.
- `installation_id` returned from a GitHub installation callback is never
  trusted directly — always independently re-verified via
  `GET /app/installations/{id}` before any database write.
- Auth/authorization enforcement lives in `apps/api/src/plugins/session.ts`
  (resolves `request.user` for every request) and a `requireAuth`
  preHandler applied per-route (`/auth/me`, `/github/install`,
  `/github/install/callback`, `/repositories`) — matching this document's
  earlier intent: middleware applied per-route, not globally bypassed.

### GitHub credentials

- Least privilege: the GitHub App requests **Metadata: Read-only** and
  **Contents: Read-only** (added for exact-commit-SHA resolution — see
  below), and nothing else (see
  [docs/github-integration.md](github-integration.md) for the full
  permission rationale, including the manual approval step existing
  installations must complete).
- **Generate, use, discard** — no GitHub credential is ever persisted:
  - The user's OAuth access token is used once (to fetch their GitHub
    profile) and discarded — never written to the database.
  - Installation access tokens and App JWTs are generated on demand via
    `@octokit/auth-app` (`apps/api/src/github/auth.ts`), used immediately,
    and discarded. Only the `github_installation_id` is persisted.
  - The App private key, OAuth client secret, and client ID are read only
    from validated env config, never logged, never returned in any API
    response.
- No GitHub credential of any kind ever reaches `apps/web` or browser
  JavaScript. `apps/web` only ever holds the opaque Patchwork session
  cookie.

### No CORS (server-to-server cookie forwarding)

`apps/api` exposes no CORS policy. `apps/web`'s Server Components forward
the session cookie manually on server-to-server requests to `apps/api`
(never subject to browser CORS); the browser only ever navigates directly
to `apps/api` for the GitHub OAuth/install redirects, which aren't CORS
requests either. See [ADR-003](adr/0003-server-to-server-cookie-forwarding.md).

## Threat model (initial)

**Private source code.** Customer repositories are sensitive, untrusted
input. **Genuinely relevant on two routes now**: `POST /repositories/:id
/analyses` (evidence collection) and `POST /analysis-runs/:id/impact-
assessments` (impact assessment — re-downloads and re-extracts the same
exact-SHA archive independently, never reusing or caching the first
download) both call `GitHubClient.downloadRepositoryArchive`
(`apps/api/src/github/client.ts`) and extract a narrow allowlist of files
(manifests, lockfiles, `tsconfig.json`, `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`
/`.cjs` source, excluding `node_modules`/`.git`/build output — see
`apps/api/src/analysis/archive.ts`), reading their text content to
produce evidence and findings. Controls in place:

- **No permanent storage**: the archive and every extracted file live only
  in a per-request OS temp directory
  (`fs.mkdtemp(os.tmpdir(), 'patchwork-archive-')`), removed in a `finally`
  block on both success and failure — verified by automated tests
  (`analysis/__tests__/archive.test.ts`) that assert the temp directory no
  longer exists afterward, including when the caller's handler throws.
  **Only structured evidence/findings** (package names, version strings,
  an `apiVersion` value and its source file/line; for impact assessment, a
  matched symbol name and file/line) is persisted to PostgreSQL
  (`analysis_evidence.evidence`, `impact_findings`) — never raw file
  content.
- **Untrusted archive treated as untrusted**: extraction uses the `tar`
  library, which rejects/strips absolute paths and `..` traversal entries
  by default (`preservePaths` is never set) — Zip Slip protection from the
  library, verified by automated tests using a hand-crafted malicious tar
  entry. Extraction is additionally selective (an allowlist `filter`, not
  "extract everything"), with per-entry and total-file-count size caps.
  The raw archive download itself is also capped (200 MB, enforced by
  streaming byte-counting, not trusting `Content-Length`).
- **No content ever logged**: only file _paths_ appear in log output on
  failure (`request.log.error({ err })`), never file contents or archive
  bytes.
- **No repository code execution**: reading/parsing is the only operation
  performed on extracted files — no `npm install`/`pnpm install`, no
  scripts, no compilation/execution against installed dependencies
  (`node_modules` is never extracted in the first place). Evidence
  collection parses with `ts.createSourceFile` (syntax only). Impact
  assessment goes further — a real `ts.Program`/`TypeChecker` (needed for
  genuine semantic proof, not a text match) — but still only ever
  type-checks against a small, **Patchwork-owned, trusted, committed**
  ambient type stub (`apps/api/src/analysis/impact/stripe-type-stub.ts`,
  not downloaded, not customer-supplied, reviewed like any other rule
  code) plus one candidate source file at a time, in-memory (`noLib: true`,
  no real lib/`node_modules` ever read) — still reading/type-analyzing
  text, never executing it.

Retention/scope beyond "delete immediately after each request" remains an
open question if a future slice needs to keep source around longer (e.g.
for caching across repeated analyses) — not needed by this slice; evidence
collection and impact assessment each independently download-use-delete,
accepted as a bounded, explained tradeoff rather than building a source
cache.

**GitHub credentials.** Addressed above (generate/use/discard,
least-privilege permissions, never logged).

**Webhook spoofing/replay.** No webhooks are implemented in this slice (see
github-integration.md). When they are, signatures must be verified before
being trusted, and processing must be idempotent.

**Tenant/repository isolation.** Once multiple customers exist,
authorization must enforce that one customer's data (repositories, patches,
assessments) is never visible or actionable by another. Partially addressed
today: `/repositories` only ever returns rows for installations the current
session's user connected. Full multi-tenant isolation (e.g. team access to
a shared installation) remains an open question — see data-model.md.

**Untrusted repository execution.** Anything that runs customer code —
including `npm install` / `pnpm install`, which can execute arbitrary
install scripts — is code execution on untrusted input, not a safe setup
step. Required future control: this must happen in an isolated sandbox,
never directly inside the `apps/api` or `apps/worker` process/environment.
**Still not crossed**: impact assessment now runs a real TypeScript
`Program`/`TypeChecker` over candidate source files (see above), which is
meaningfully deeper analysis than the evidence slice's syntax-only
parsing, but remains reading/type-checking text — never installing
dependencies, never compiling to executable output, never running a
script or test from the repository.

**Prompt injection.** Customer source code and external API documentation
are both untrusted input to any future LLM step. Content from either must
not be able to change what actions the system takes — see "AI system
principles" in [CLAUDE.md](../CLAUDE.md#ai-system-principles). Not yet
relevant: no AI/LLM usage exists in this slice.

**Malicious external documentation.** Changelogs, release notes, and API
docs ingested for change detection are external, untrusted input and should
be treated the same as any other untrusted content. Not yet relevant.

**Sensitive logging.** Secrets, credentials, and full customer source code
must never be written to logs. Addressed above for GitHub credentials.

**Dependency/supply-chain risk.** Lockfile is committed and CI installs
with `--frozen-lockfile`. No automated vulnerability scanning exists yet.

## Open questions

- Secret storage for customer GitHub credentials at rest (currently nothing
  is stored beyond the installation ID, so this is moot until a credential
  actually needs persisting).
- Exact sandbox design for untrusted repository execution (see
  [verification.md](verification.md)) is undecided.
- Multi-tenant/team access model beyond "first connector wins" (see
  data-model.md).
- Whether a future slice needs to cache/retain extracted repository
  content across repeated analyses (currently: none, every trigger
  re-downloads and deletes immediately).

## Deferred

- Rate limiting, audit logging, and automated dependency vulnerability
  scanning in CI.
- The sandbox for untrusted repository/package-install execution.
- Session cleanup for expired rows (harmless bloat, not a security issue —
  see data-model.md).
