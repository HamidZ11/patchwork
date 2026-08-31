# Architecture

## Style: modular monolith

Patchwork is a TypeScript modular monolith split into three processes, run
from a single pnpm/Turborepo workspace. See
[ADR-001](adr/0001-modular-monolith-processes.md) for the full reasoning.

Microservices are inappropriate right now: the domain boundaries (especially
around impact analysis, the unsolved hard problem) aren't known yet.
Splitting into services today would mean guessing those boundaries and
paying network/deployment/versioning overhead for a product with no users
and no proven load profile. See ADR-001's "Why not microservices" section.

## Current components (CURRENT)

```
apps/
  web/      Next.js frontend — signed-out landing ("/") and the
            /repositories screen (onboarding + connected states). First
            component to depend on apps/api (see ADR-003).
  api/      Fastify HTTP API — GET /health, GET /ready, plus the GitHub
            connection flow (see below).
  worker/   Long-running Node process — starts, pings PostgreSQL, shuts
            down gracefully; runs no jobs yet

packages/
  config/   Central, validated environment configuration shared by
            apps/api and apps/worker (zod)
  db/       PostgreSQL access via Drizzle ORM + drizzle-kit migrations.
            Tables: app_metadata (foundation-proving), users, sessions,
            github_installations, repositories — see docs/data-model.md

docs/       Architecture and product documentation, including ADRs
```

### apps/api's GitHub connection flow (CURRENT)

```
apps/api/src/
  config.ts          apps/api-only env config (GitHub App credentials,
                      session cookie domain, web app URL) -- separate from
                      packages/config since apps/worker needs none of it
  github/
    client.ts         raw fetch wrappers over GitHub's OAuth/REST HTTP
                       boundary, injectable for tests; also owns
                       downloadRepositoryArchive (streams the exact-SHA
                       tarball to a caller-given path, size-capped)
    auth.ts            wraps @octokit/auth-app: generates a short-lived App
                       JWT or installation access token on demand, never
                       cached/persisted
    installations.ts  orchestration only: validates + syncs one
                       installation's repositories
    persistence.ts    idempotent upsert of installations/repositories
                       (Postgres unique constraints, not check-then-insert)
  auth/
    users.ts          upserts a User keyed on github_user_id
    sessions.ts       creates/looks up/deletes DB-backed sessions
  analysis/
    version.ts        ANALYZER_VERSION constant (hardcoded, manually bumped)
    snapshots.ts       orchestration only: resolves the exact current commit
                       SHA for a repository's default branch via github/
    archive.ts          generic (no GitHub knowledge) safe extraction of a
                       downloaded .tar.gz into a temp dir -- selective
                       allowlist filter, guaranteed cleanup
    evidence.ts         orchestration: download (github/) -> extract
                       (archive.ts) -> evidence extractors (evidence/) ->
                       StripeEvidence, with guaranteed cleanup
    evidence/
      types.ts          zod-validated StripeEvidence shape (see
                        docs/data-model.md)
      manifests.ts       discovers package.json files + stripe dependency
                        declarations (no glob-matching of workspace config)
      lockfiles.ts       resolves declared ranges against package-lock.json
                        / pnpm-lock.yaml (yarn.lock recognized, not parsed)
      api-version.ts     AST-only (ts.createSourceFile, no type-checked
                        Program) scan for `new Stripe(..., { apiVersion })`
    persistence.ts     idempotent upsert of RepositorySnapshot; insert of
                       AnalysisRun (+ AnalysisEvidence, together, only when
                       status is 'completed'); repository ownership lookup;
                       latest-analysis-per-repository lookup
  plugins/
    session.ts        resolves request.user for every request; a
                       requireAuth preHandler enforces it per-route
    cookies.ts        hand-rolled cookie parse/set (no @fastify/cookie --
                       every cookie value here is a self-generated,
                       fixed-charset token, so there's no arbitrary-value
                       escaping to get right)
    oauth-state.ts    single-use `state` generation/validation shared by
                       both the login and install flows
  routes/
    auth.ts            GET /auth/github/login, GET /auth/github/callback,
                       GET /auth/me, POST /auth/logout
    github.ts          GET /github/install, GET /github/install/callback,
                       GET /repositories
    analyses.ts         POST /repositories/:id/analyses
```

Routes stay thin (parse/validate → call `github/`/`auth/`/`analysis/` →
shape response); GitHub-specific HTTP/JWT logic never appears in a route
handler. Full design and rationale:
[docs/github-integration.md](github-integration.md),
[docs/security.md](security.md),
[docs/data-model.md](data-model.md#repository_snapshots).

### apps/api's snapshot/analysis-run + evidence flow (CURRENT)

`POST /repositories/:id/analyses` resolves a connected repository's exact
current commit SHA and records it as an immutable `RepositorySnapshot`
(reproducibility foundation, unchanged from the prior slice), then
downloads the exact-SHA archive and collects deterministic Stripe/
TypeScript applicability evidence from it — never a decision about whether
any provider change affects the repository, only what's discoverable from
source (installed SDK versions, explicit `apiVersion` configuration). No
repository code is ever executed; only text is read (see
[docs/security.md](security.md)). Runs synchronously in the request
handler (one GitHub API call for the SHA + one archive download/extract +
one DB transaction); no queue or background worker — the workload is
bounded (small selective extraction, no `node_modules`) and comparable in
cost to the GitHub call this route already made before evidence
collection existed. `analysis/` mirrors `github/`'s existing split:
orchestration (`snapshots.ts`, `evidence.ts`, `archive.ts` — no DB access)
separate from persistence (`persistence.ts`, no HTTP/filesystem access).
See [docs/data-model.md](data-model.md) for the schema, evidence shape,
and idempotency guarantees.

## Dependency direction

`apps/api` and `apps/worker` depend on `packages/config` and `packages/db`.
`apps/web` now depends on `apps/api` — over HTTP (server-to-server, from
Server Components; see [ADR-003](adr/0003-server-to-server-cookie-forwarding.md)),
not a source/package dependency. `apps/api` and `apps/worker` still don't
depend on each other's internals; they communicate only through shared
infrastructure (currently just PostgreSQL).

PostgreSQL is the only datastore. No queue, cache, or message broker exists
yet (see [ADR-002](adr/0002-drizzle-for-postgres-access.md) for the data
access layer decision).

## Expected high-level future flow (PROPOSED, not implemented)

Per the core workflow in [CLAUDE.md](../CLAUDE.md#product): an external API
change is normalized, matched against connected repositories, run through
impact analysis, and — if affected — turned into a verified patch and a
GitHub PR. The likely process split is ingestion and heavy analysis/patching
running in `apps/worker` (asynchronous, potentially slow), with `apps/api`
serving the web UI and any customer-facing endpoints. This has not been
designed in detail; see the per-concern docs
([api-change-ingestion.md](api-change-ingestion.md),
[impact-analysis.md](impact-analysis.md),
[patch-generation.md](patch-generation.md),
[verification.md](verification.md)) for what's actually decided versus open.

Patchwork is sequenced as **an evidence-producing impact engine first** —
detect, locate, and explain with calibrated confidence — with deterministic
fixes and PR automation layered on only once that's trustworthy. See
[impact-analysis.md](impact-analysis.md#product-positioning-proposed--correction)
for the full reasoning and the corrected data shapes this implies
(`RepositorySnapshot`/`AnalysisRun`, version applicability as evidence
rather than one repository field, and the structured `ProviderChange`
breakdown) in [data-model.md](data-model.md#candidate-domain-concepts-proposed--not-implemented).

External research (August 2026) reviewed this repository's existing
architecture — modular monolith, GitHub App installation-token boundary,
Postgres-backed worker, no queue/cache/microservices — and did not find a
reason to change any of it. The one new infrastructure boundary that
research argues is genuinely justified, once verification exists, is
**untrusted sandbox execution** (buy, e.g. E2B or Vercel Sandbox, rather
than self-host) — a security boundary, not a scaling one. See
[verification.md](verification.md) and [security.md](security.md).

## Open questions

- How the worker will pick up jobs (polling a table vs. a queue) once
  background work exists.
- Whether `apps/api` and `apps/worker` remain separate deployable processes
  or are ever split further — not expected before this needs revisiting.

## Deferred

Any design for API-change ingestion, impact analysis, patch generation, or
verification beyond what's recorded in their respective docs. Each will be
designed as its own vertical slice before implementation.
