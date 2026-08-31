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
    impact.ts            orchestration: re-download archive (github/) ->
                       extract (archive.ts) -> assessAllRulesImpact runs
                       every registered rule (impact/registry.ts) against
                       the same extracted files for an existing
                       AnalysisRun's evidence (one download shared by all
                       rules, not one per rule)
    impact-persistence.ts idempotent upsert of ProviderChange/RuleVersion;
                       upsert of ImpactAssessment (+ Findings, replaced
                       wholesale) on (analysis_run_id, rule_version_id);
                       analysis-run ownership lookup; latest-assessments-
                       per-analysis-run lookup returns an array (multiple
                       rules per run)
    impact/
      registry.ts        IMPACT_RULES: RuleDefinition[] -- every
                       currently-known rule; adding a rule means adding a
                       file to rules/ and reviewing it like any other code,
                       not an ingestion pipeline
      rules/              one file per hardcoded, manually-verified
                       ProviderChange + RuleVersion + applicabilityConfig +
                       predicate composition (see docs/impact-analysis.md
                       for provenance of all four)
      stripe-type-stub.ts  a small, Patchwork-owned, trusted `declare
                       module 'stripe'` ambient type stub (plus a minimal
                       ambient Promise<T> for await-unwrapping) -- not
                       downloaded, not customer-supplied -- letting the
                       TypeChecker resolve real Stripe provenance without
                       ever installing a real node_modules
      applicability.ts   pure function, parameterized by an
                       ApplicabilityConfig per rule: StripeEvidence ->
                       per-workspace APPLICABLE / NOT_APPLICABLE /
                       UNKNOWN, no new network calls
      predicates/
        engine.ts          shared scanning infrastructure: cheap lexical
                         prefilter -> one bounded, in-memory Program per
                         candidate source file (trusted stub + that file
                         only) -> a rule-specific PredicateVisitor
        member-access.ts   does a property access resolve to the stub?
                         (method/property removal -- two rules)
        call-argument-property.ts  does a call resolving to the stub
                         contain a named object-literal argument property?
                         (request-parameter removal)
        literal-comparison.ts      does a stub-typed property get compared
                         against a specific string literal? (enum/literal-
                         domain split)
      assess.ts          assessRuleImpact(evidence, files, coverage, rule):
                       combines applicability + a rule's predicate into one
                       tri-state verdict per workspace, aggregated to one
                       ImpactAssessment -- shared by every rule
      types.ts           zod-validated ImpactCoverage/Finding shapes;
                       RuleDefinition/ProviderChangeDefinition types
  benchmark/
    types.ts            BenchmarkCase/CaseOutcome/RuleReport/BenchmarkReport
    cases/               hand-written, hand-labelled fixture corpus, one
                       file per rule (~11 cases each), never generated by
                       running the analyser being evaluated
    run.ts               runs every case through the real production
                       pipeline (buildStripeEvidenceFromFiles ->
                       assessRuleImpact against the real IMPACT_RULES),
                       classifies (expected, actual) into safety-labelled
                       buckets -- see docs/impact-analysis.md
    format.ts            human-readable + JSON report formatting
    cli.ts                tsx entry point for `pnpm benchmark`; exits
                       non-zero on any false-NOT_AFFECTED safety failure
    __tests__/safety-gate.test.ts  runs the full corpus inside `pnpm test`
                       (CI-enforced), asserting zero false-NOT_AFFECTED
                       safety failures and zero unsafe-certainty results
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
    impact-assessments.ts POST /analysis-runs/:id/impact-assessments
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

### apps/api's impact-assessment flow (CURRENT, four Stripe rules)

`POST /analysis-runs/:id/impact-assessments` evaluates every
currently-known `RuleVersion` (today: four materially different Stripe
changes — see [docs/impact-analysis.md](impact-analysis.md)) against an
existing, already-authorized `AnalysisRun`, in one call. It re-downloads
and re-extracts the exact-SHA archive **once** (the original extraction
from evidence collection was already deleted — no permanent source
storage, so a fresh acquisition is the same download-use-delete pattern,
not a cache) and runs every registered rule's predicate against that same
extracted file set — one download shared across all rules, a real
efficiency consequence of having more than one rule. It combines the
result with the run's already-persisted `StripeEvidence` for
applicability, and produces one evidence-backed `AFFECTED` /
`NOT_AFFECTED` / `UNCERTAIN` `ImpactAssessment` per rule, each with its
own `Finding` rows — real TypeScript Compiler API semantic proof
(`impact/predicates/`), never a text/regex match as the verdict. Runs
synchronously, same reasoning as the evidence flow above (a second bounded
archive download/extraction, not a heavier workload). No assessment is
persisted if archive re-acquisition itself fails (fail closed — an
`ImpactAssessment` should always represent a completed evaluation with
genuine evidence-based reasoning, not an infrastructure error). See
[docs/data-model.md](data-model.md) for the schema and idempotency
(`(analysis_run_id, rule_version_id)` unique per rule, upserted) and
[docs/impact-analysis.md](impact-analysis.md) for the tri-state safety
policy, analyzer design, and the benchmark that measures whether this
generalizes across rule shapes.

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
