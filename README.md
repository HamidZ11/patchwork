# Patchwork

Patchwork will detect when a third-party API changes, determine whether the
change affects a customer's codebase, generate a minimal migration patch,
verify it safely, and open a GitHub pull request. Initial scope: GitHub only,
Stripe only, TypeScript repositories, `stripe-node`, one repository at a
time.

## Current status

**The product itself (Stripe change detection, impact analysis, patching)
is not implemented.** What exists is the engineering foundation plus the
first real vertical slice: connecting a GitHub account and repository.

- A pnpm/Turborepo monorepo with three apps and two shared packages.
- A Fastify API with `GET /health`, `GET /ready`, and the GitHub connection
  flow: sign in with GitHub, install the Patchwork GitHub App, select
  repositories, and have them recorded and listed.
- A Next.js frontend with a signed-out landing page and a `/repositories`
  screen (onboarding + connected states).
- A worker process that starts, pings PostgreSQL, and shuts down gracefully
  — no jobs run yet.
- PostgreSQL connectivity and migrations via Drizzle:
  `app_metadata` (foundation-proving), `users`, `sessions`,
  `github_installations`, `repositories`.
- Centralized, validated environment configuration.
- Unit and integration tests (including a fakeable GitHub HTTP boundary —
  no real network calls in tests), and CI.

No Stripe integration, AI/LLM usage, repository content access, impact
analysis, patch generation, or background jobs exist yet.

See `docs/` for architecture and product documentation, including
[ADR-001](docs/adr/0001-modular-monolith-processes.md) (why a modular
monolith, not microservices), [ADR-002](docs/adr/0002-drizzle-for-postgres-access.md)
(why Drizzle), and [ADR-003](docs/adr/0003-server-to-server-cookie-forwarding.md)
(why `apps/web` talks to `apps/api` without CORS).

## Architecture overview

```
apps/
  web/      Next.js frontend
  api/      Fastify HTTP API — health/readiness + GitHub connection flow
  worker/   Long-running Node process for future background jobs

packages/
  config/   Central, validated environment configuration (shared)
  db/       PostgreSQL access (Drizzle) and migrations

docs/       Architecture, product, and ADR documentation
```

## Prerequisites

- Node.js 20 LTS or newer
- pnpm (via [Corepack](https://nodejs.org/api/corepack.html): `corepack enable`)
- Docker (for local PostgreSQL via Docker Compose)
- A GitHub account, to create a GitHub App for local testing of the
  connection flow — see [docs/github-integration.md](docs/github-integration.md#manual-github-app-setup)

## Local setup

```bash
git clone <repo>
cd Patchwork
cp .env.example .env
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

- `apps/web` runs at http://localhost:3000
- `apps/api` runs at http://localhost:3001 (`GET /health`, `GET /ready`,
  the GitHub connection flow)
- `apps/worker` runs in the background with no HTTP port

The GitHub connection flow (`apps/api`'s `GITHUB_*` variables) requires a
real GitHub App to actually sign in/install against GitHub — see
[docs/github-integration.md](docs/github-integration.md#manual-github-app-setup)
for exact setup steps. `apps/api` will fail to start if those variables are
missing or malformed (fail-fast config validation).

## Required environment variables

See `.env.example` for the full list with placeholders. Shared config is
validated in `packages/config/src/env.ts`; `apps/api`-only config (GitHub
App credentials, session cookie domain, web app URL) is validated in
`apps/api/src/config.ts`.

| Variable                    | Required  | Description                                                           |
| --------------------------- | --------- | --------------------------------------------------------------------- |
| `NODE_ENV`                  | no        | `development` \| `test` \| `production`                               |
| `DATABASE_URL`              | yes       | PostgreSQL connection string                                          |
| `API_PORT`                  | no        | Port `apps/api` listens on (default `3001`)                           |
| `LOG_LEVEL`                 | no        | pino log level (default `info`)                                       |
| `GITHUB_APP_ID`             | yes (api) | GitHub App's numeric App ID                                           |
| `GITHUB_APP_SLUG`           | yes (api) | GitHub App's URL slug                                                 |
| `GITHUB_CLIENT_ID`          | yes (api) | GitHub App OAuth client ID                                            |
| `GITHUB_CLIENT_SECRET`      | yes (api) | GitHub App OAuth client secret                                        |
| `GITHUB_PRIVATE_KEY_BASE64` | yes (api) | GitHub App private key, base64-encoded                                |
| `SESSION_COOKIE_DOMAIN`     | no        | Shares the session cookie across subdomains in production             |
| `WEB_APP_URL`               | yes (api) | Where `apps/api` redirects the browser after OAuth/install            |
| `API_URL`                   | no        | Where `apps/web` reaches `apps/api` (default `http://localhost:3001`) |

## Development commands

```bash
pnpm dev         # run web, api, and worker in dev mode
pnpm build       # build every app/package
pnpm lint        # lint every app/package
pnpm typecheck   # typecheck every app/package
pnpm format      # format the repo with Prettier
pnpm format:check
```

## Testing commands

```bash
pnpm test                            # every package/app, via Turborepo
pnpm --filter @patchwork/api test    # a single package
```

PostgreSQL integration tests require a reachable, migrated database
(`docker compose up -d postgres && pnpm db:migrate` locally; a service
container + migrate step in CI). See [docs/testing.md](docs/testing.md) for
isolation details. Tests never make real network calls to GitHub — the
GitHub HTTP boundary is fakeable (see `apps/api/src/__tests__/fixtures.ts`).

## Database migration commands

```bash
pnpm db:migrate                                   # apply migrations
pnpm --filter @patchwork/db generate              # generate a new migration from schema changes
```
