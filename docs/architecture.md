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
                       boundary, injectable for tests
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
```

Routes stay thin (parse/validate → call `github/`/`auth/` → shape response);
GitHub-specific HTTP/JWT logic never appears in a route handler. Full design
and rationale: [docs/github-integration.md](github-integration.md),
[docs/security.md](security.md).

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

## Open questions

- How the worker will pick up jobs (polling a table vs. a queue) once
  background work exists.
- Whether `apps/api` and `apps/worker` remain separate deployable processes
  or are ever split further — not expected before this needs revisiting.

## Deferred

Any design for API-change ingestion, impact analysis, patch generation, or
verification beyond what's recorded in their respective docs. Each will be
designed as its own vertical slice before implementation.
