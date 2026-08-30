# Testing

## Philosophy

Tests exist to prove behaviour, not to inflate a count. A test that doesn't
assert something meaningful about real behaviour (or that only exercises a
mock of the thing it claims to test) isn't pulling its weight. This applies
equally to the current foundation tests and to future impact-analysis
evaluation — see below.

## Current (CURRENT)

Vitest is the test runner across every package and app.

- **Unit tests** (`packages/config`) construct inputs directly and assert
  on return values / thrown errors. No external services required.
- **API integration tests** (`apps/api/src/__tests__/app.test.ts`) build
  the Fastify app via `buildApp()` and use Fastify's `.inject()` to
  exercise routes in-process, with a fake `DbClient` — no real server
  socket or database needed. This keeps the suite fast and deterministic.
- **PostgreSQL integration tests**
  (`packages/db/src/__tests__/client.test.ts`,
  `apps/api/src/__tests__/ready.integration.test.ts`,
  `apps/api/src/__tests__/auth.integration.test.ts`,
  `apps/api/src/__tests__/github.integration.test.ts`) run against a real
  PostgreSQL instance, exercising real user/session/installation/repository
  persistence and uniqueness/idempotency (duplicate upserts converge to one
  row). They require `DATABASE_URL` to point at a reachable, migrated
  PostgreSQL database — either `docker compose up -d postgres` +
  `pnpm db:migrate` locally, or the `postgres` service container plus the
  migrate step in CI (migrations run once as a separate CI step, not inside
  every test file).
- **The GitHub HTTP boundary is fakeable, never real.** `apps/api/src/github/client.ts`
  and `github/auth.ts` accept an injectable `fetch`/auth implementation
  (`apps/api/src/__tests__/fixtures.ts` provides `fakeGitHubClient` and
  `fakeGitHubAppAuth`). Tests never make real network calls to GitHub, and
  never mock Patchwork's own logic (`installations.ts`, routes, persistence
  all run for real against the fakes) — only the external HTTP boundary is
  faked.

### Test isolation

- Each PostgreSQL integration test that writes data uses a unique key
  (`crypto.randomUUID()`) and deletes what it inserted, so tests can run
  against a shared local database without colliding.
- Migrations are idempotent (`drizzle-orm`'s migrator tracks applied
  migrations in the database), so running them in `beforeAll` on every test
  run is safe.
- No test relies on execution order within or across files.
- Local `.env` values (if present) are loaded by each app/package's
  `vitest.config.ts` via `dotenv`; CI sets `DATABASE_URL` directly as a
  workflow environment variable instead of relying on a committed `.env`.
- `apps/web` has no automated tests yet — it's presentation-only in this
  slice (renders based on `apps/api` responses; no client-side logic of its
  own worth unit testing). The connection flow's actual logic lives in and
  is tested by `apps/api`.

### Running tests

```bash
pnpm test              # every package/app, via Turborepo
pnpm --filter @patchwork/db test   # a single package
```

## Future testing needs (PROPOSED — not implemented)

The current unit/integration approach doesn't cover what most needs
validating once product features exist:

- **Tests against real GitHub** — the automated suite fakes the GitHub HTTP
  boundary (see above); nothing runs against GitHub's real API. Manual
  verification against a real GitHub App remains necessary (see
  docs/github-integration.md) until this gap is addressed, e.g. with a
  recorded-fixture or contract-test approach.
- **Stripe integration tests** — against real or realistic Stripe API
  behaviour, not just mocks. No Stripe integration exists yet at all.
- **Fixture repositories** — small, real-shaped TypeScript repositories
  used as targets for impact analysis and patch generation testing, not
  synthetic one-liners.
- **A labelled impact-analysis evaluation set** — fixture repositories
  paired with known-correct expected outcomes for real Stripe breaking
  changes, used to measure the pipeline's actual accuracy. See
  [impact-analysis.md](impact-analysis.md).
- **Precision/recall tracking** for impact analysis — false positives and
  false negatives tracked as an ongoing metric, not just pass/fail on a
  fixed test list, since the underlying analysis is probabilistic in
  practice even where individual steps are deterministic.
- **Patch regression tests** — once patch generation exists, confirming a
  known change still produces the expected (or an equally valid) patch
  over time, to catch silent regressions in generation quality.

## Open questions

- Whether PostgreSQL integration tests should run against a dedicated test
  database/schema instead of the default `patchwork` database once more
  tables exist.
- How the labelled evaluation set is maintained and versioned as more
  Stripe changes are added to it.

## Deferred

Everything under "Future testing needs" above — none of it exists yet.
