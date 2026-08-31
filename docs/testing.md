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
  `apps/api/src/__tests__/github.integration.test.ts`,
  `apps/api/src/__tests__/analyses.integration.test.ts`,
  `apps/api/src/__tests__/impact-assessments.integration.test.ts`) run
  against a real PostgreSQL instance, exercising real
  user/session/installation/repository/snapshot/analysis-run/evidence/
  impact-assessment persistence and uniqueness/idempotency (duplicate
  upserts converge to one row). `analyses.integration.test.ts` covers:
  authorization (404, not 403, for a repository connected by a different
  user — no existence leak); the fail-closed/no-partial-write behavior
  when SHA resolution fails; that a `'failed'` `AnalysisRun` (no
  `analysis_evidence` row) is recorded — without discarding the
  already-valid snapshot — when archive acquisition fails; real Stripe
  evidence persisted and correctly linked to its `analysis_run_id` when a
  fixture archive declares a dependency; that repeated triggers against
  an unchanged commit converge to one `RepositorySnapshot` but create a
  new `AnalysisRun` (and its own evidence row) each time; and FK/cascade
  behavior when a repository is deleted.
  `impact-assessments.integration.test.ts` covers: authorization (401
  unauthenticated, 404 for an `AnalysisRun` connected by a different user
  — no existence leak), 409 when the target run has no evidence to assess,
  a real positive fixture (`stripe@18.2.0`, a genuine
  `stripe.invoices.retrieveUpcoming` call) persisting one `AFFECTED`
  assessment (among all four registered rules' assessments, each
  persisted per `AnalysisRun`) with a `Finding` correctly linked to it, a
  real negative fixture (same SDK version, `createPreview` instead)
  persisting `NOT_AFFECTED` for every rule, `ProviderChange`/`RuleVersion`
  upsert idempotency, that re-triggering an assessment for the same
  `AnalysisRun` converges to one `ImpactAssessment` row per rule (not
  duplicated) with findings replaced, and that deleting an
  `ImpactAssessment` cascades to its `Finding` rows. They require
  `DATABASE_URL` to point at a reachable, migrated PostgreSQL database —
  either `docker compose up -d postgres` + `pnpm db:migrate` locally, or
  the `postgres` service container plus the migrate step in CI
  (migrations run once as a separate CI step, not inside every test
  file).
- **The GitHub HTTP boundary is fakeable, never real.** `apps/api/src/github/client.ts`
  and `github/auth.ts` accept an injectable `fetch`/auth implementation
  (`apps/api/src/__tests__/fixtures.ts` provides `fakeGitHubClient` and
  `fakeGitHubAppAuth`, plus `fakeGitHubClientWithArchive` for
  archive-acquiring tests). Tests never make real network calls to GitHub,
  and never mock Patchwork's own logic (`installations.ts`, routes,
  persistence, archive extraction, evidence extraction all run for real
  against the fakes) — only the external HTTP boundary is faked.
- **Fixture archives are built in-memory, not checked in.**
  `apps/api/src/__tests__/build-fixture-archive.ts`'s `buildFixtureArchive`
  packs a flat path→content map into a real `.tar.gz` (via the `tar`
  library, wrapped in a synthetic `<owner>-<repo>-<sha>/` root matching
  GitHub's real layout) so tests exercise genuine extraction, not a mock of
  it. `buildMaliciousTarGz` hand-crafts a single raw tar entry with an
  attacker-controlled path (traversal or absolute) to prove `tar.x`'s Zip
  Slip protection actually rejects it on extraction
  (`apps/api/src/analysis/__tests__/archive.test.ts`) — deliberately
  bypassing the normal packer, which wouldn't produce such a path from a
  real file.
- **Evidence extraction is unit-tested independent of the DB/HTTP boundary**
  (`apps/api/src/analysis/evidence/__tests__/{manifests,lockfiles,
api-version}.test.ts`): manifest/workspace discovery, declared-range vs.
  lockfile-resolved (`package-lock.json` and `pnpm-lock.yaml`) version
  resolution including `CONFLICTING`/`UNKNOWN`, `yarn.lock` recognized but
  not parsed, multiple Stripe contexts in a monorepo never collapsed,
  literal/local-constant/dynamic `apiVersion` classification, an unrelated
  `apiVersion`-named property outside a Stripe construction producing no
  evidence, and malformed source/manifests handled without crashing.
- **Impact assessment is unit-tested independent of the DB/HTTP boundary**:
  `apps/api/src/analysis/impact/__tests__/applicability.test.ts` (SDK
  version `>= 18.0.0` → `APPLICABLE`; pre-Basil `apiVersion` →
  `NOT_APPLICABLE`; unresolved/absent evidence → `UNKNOWN`; conflicting
  `apiVersion`s across constructions → `UNKNOWN`; multiple workspaces never
  collapsed; a second, different `ApplicabilityConfig` boundary — SDK v19 /
  2025-09-30 — proving the boundary is a genuine per-rule parameter, not a
  global constant). Each predicate primitive has its own fixture matrix
  under `apps/api/src/analysis/impact/predicates/__tests__/`:
  `member-access.test.ts` (16 scenarios, real in-memory `ts.Program`s —
  direct calls, same-file aliases, bare method references, different file
  layouts, and a monorepo workspace as positives; an unrelated same-named
  method, comment/string-only mentions, a user-defined type with the same
  property, an unused-but-present dependency, and a non-property-access
  identifier as negatives; dynamic construction, an unresolved import, and
  a cross-file wrapper as `UNCERTAIN`; a same-file wrapper function
  resolving correctly, not falling to `UNCERTAIN`); `call-argument-
property.test.ts` and `literal-comparison.test.ts` (14 scenarios each,
  the same positive/negative/uncertain shape, adapted to their own
  predicate contract — e.g. an unresolved callee with no matching argument
  property is correctly "not interesting," not ambiguous, to avoid
  `UNCERTAIN`-flooding on unrelated dynamic code). `assess.test.ts` (tri-
  state aggregation, using the retrieveUpcoming rule as its subject: full
  coverage + no match + applicable → `NOT_AFFECTED`; incomplete coverage →
  `UNCERTAIN`; a confirmed match → `AFFECTED`; `UNKNOWN` applicability
  capping the result even when the predicate independently matches;
  `AFFECTED` in one workspace winning over `UNCERTAIN` in another;
  truncated archive extraction downgrading an otherwise-`NOT_AFFECTED`
  result but never an `AFFECTED` one) — this aggregation logic is shared
  by all four rules via `assessRuleImpact(evidence, files, coverage,
rule)`, so one rule's fixture matrix is sufficient to cover it.
- **The impact benchmark is a CI-enforced safety gate, not just a manual
  report** (CURRENT): `apps/api/src/benchmark/__tests__/safety-gate.test.ts`
  runs the full hand-labelled corpus (`apps/api/src/benchmark/cases/`, ~11
  cases × 4 rules) through the real production pipeline inside `pnpm test`
  and asserts `falseNotAffectedSafetyFailures === 0` and
  `unsafeCertaintyCount === 0` — see [impact-analysis.md](impact-analysis.md#evaluation-approach-current--controlled-benchmark-real-historical-pairs-still-proposed)
  for the full design, classification table, and current results.
  `pnpm benchmark` runs the same corpus as a standalone report (human-
  readable, or `--json`), without needing a database.

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
- **Real-GitHub fixture repositories beyond `stripe-basil-fixture`** —
  small, real-shaped TypeScript repositories used as targets for impact
  analysis and (later) patch generation testing. A labelled, hand-written
  benchmark corpus and CI-enforced safety gate now exist (see
  [impact-analysis.md](impact-analysis.md#evaluation-approach-current--controlled-benchmark-real-historical-pairs-still-proposed));
  additional purpose-built real-GitHub repositories for rules B/C/D remain
  a candidate follow-up, proposed only if a materially different predicate
  shape genuinely needs real-GitHub confidence beyond the controlled corpus.
- **Real historical migration pairs** — a commit before a real Stripe
  upgrade and the commit after the corresponding developer migration, for
  realism the controlled benchmark corpus can't fully provide. Deferred;
  not attempted in the benchmark slice.
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
