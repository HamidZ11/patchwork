# Data Model

## Current (CURRENT)

Schema is defined with Drizzle in `packages/db/src/schema.ts`; see
[ADR-002](adr/0002-drizzle-for-postgres-access.md). All tables below exist
in the database.

- **`app_metadata`** (`id`, `key`, `value`, `created_at`) — the original
  foundation-proving table, not part of the product data model.

- **`users`** — a Patchwork user, identified by their GitHub account.
  `github_user_id` (bigint, **unique**) is the identity anchor — immutable,
  unlike `github_login` (text), which is a cached display value refreshed
  on every login since GitHub logins can be renamed. `avatar_url` nullable.
  `id` is an app-generated UUID.

- **`sessions`** — a browser session. `token_hash` (the SHA-256 hash of the
  random token sent to the browser in an HttpOnly cookie) is the **primary
  key** — no separate surrogate id, since the hash is already the natural
  unique key, and the raw token is never stored. `user_id` references
  `users.id`, **`ON DELETE CASCADE`** (a deleted user's sessions are
  meaningless). `expires_at` is checked at read time; there is no cleanup
  job for expired rows — an accepted, explicitly deferred gap (harmless
  table bloat, not a security issue, since expired sessions are always
  rejected on lookup regardless of whether the row still exists).

- **`github_installations`** — an installation of the Patchwork GitHub App.
  `github_installation_id` (bigint, **unique**) is the identity anchor.
  `account_type` (`'User' | 'Organization'`, validated at the application
  layer with zod rather than a DB enum — keeps migrations low-friction per
  ADR-002) and `account_id`/`account_login` describe the installed-on
  account. `connected_by_user_id` references `users.id`,
  **`ON DELETE RESTRICT`** (a placeholder-safe default — no user-deletion
  flow exists yet, so this just prevents deleting a user who still owns an
  installation rather than encoding a real policy).

  `connected_by_user_id` records _who connected it_, not full ownership: if
  a different Patchwork user's callback later targets the same
  `github_installation_id`, ownership is **not reassigned**
  ("first connector wins" — see
  [docs/github-integration.md](github-integration.md)). There is no
  multi-user/team access model yet; this is an intentional limitation.

  **`is_active` was deliberately not implemented**, despite being a
  reasonable-sounding field: nothing in this slice sets or reads it, since
  uninstall/staleness detection (a webhook or a refresh mechanism) doesn't
  exist yet (see github-integration.md's "Webhooks" section). Adding it now
  would have been a dead column.

- **`repositories`** — a repository granted to an installation.
  `github_repository_id` (bigint, **globally unique**, not scoped per
  installation) is the identity anchor — a real GitHub repository is one
  entity regardless of which installation currently has access to it, and
  `owner`/`name`/`full_name` are cached display values (repos can be
  renamed/transferred). `installation_id` references
  `github_installations.id`, **`ON DELETE CASCADE`** (a repository row
  without its installation is meaningless). `is_private` and
  `default_branch` are genuinely used by the `/repositories` UI, not
  speculative.

### Idempotency

Both `github_installations` and `repositories` are upserted via Postgres
unique constraints + Drizzle `.onConflictDoUpdate` (not application-level
check-then-insert) — see `apps/api/src/github/persistence.ts`. A repeated
install callback for the same installation, or a repeated repository sync,
always converges to one row, never a duplicate.

### Relationships

```
users 1--N sessions            (sessions.user_id)
users 1--N github_installations (github_installations.connected_by_user_id,
                                  "connector", not full ownership)
github_installations 1--N repositories (repositories.installation_id)
repositories 1--N repository_snapshots (repository_snapshots.repository_id)
repository_snapshots 1--N analysis_runs (analysis_runs.repository_snapshot_id)
users 1--N analysis_runs        (analysis_runs.triggered_by_user_id)
analysis_runs 1--0..1 analysis_evidence (analysis_evidence.analysis_run_id, unique)
```

No join table for user↔repository access exists yet — access is entirely
mediated through "which installation did this user connect," and there is
no multi-user-per-installation sharing model in this slice.

- **`repository_snapshots`** — an immutable source identity: one exact
  commit SHA of one repository, never mutated once created. `repository_id`
  references `repositories.id`, **`ON DELETE CASCADE`** (a snapshot without
  its repository is meaningless). `commit_sha` is the exact SHA resolved
  from GitHub — **not** the mutable default-branch pointer. `ref` records
  which branch name it was resolved from (currently always the repository's
  stored default branch). `acquisition_method` is an app-validated string
  (currently only `'github_default_branch'`) describing how the SHA was
  obtained, left as text rather than a DB enum for the same low-friction
  reason as `account_type` above.

  **`(repository_id, commit_sha)` is unique** — see Idempotency below.

- **`analysis_runs`** — one execution attempt of Patchwork's
  snapshot/analysis logic against one `RepositorySnapshot`.
  `repository_snapshot_id` references `repository_snapshots.id`,
  **`ON DELETE RESTRICT`** (a run is a historical execution record; it
  should never silently disappear because its snapshot was deleted — delete
  the run first, matching the fail-closed convention used elsewhere).
  `triggered_by_user_id` references `users.id`, **`ON DELETE RESTRICT`**
  for the same reason. `analyzer_version` is the hardcoded constant from
  `apps/api/src/analysis/version.ts` (currently `'v1'`) — see "Analyzer
  version" below. `status` is app-validated text. `started_at`/`completed_at`
  bound the execution; there is no separate `created_at` on this table
  since `started_at` already serves that purpose.

  **`AnalysisRun` is a separate table from `RepositorySnapshot`, and always
  will be**, even though this slice always creates one of each together:
  the same snapshot can legitimately be re-analyzed later by a different
  analyzer version and produce a different `analysis_runs` row pointing at
  the same, unchanged snapshot.

  **Deliberately deferred fields** (do not exist as columns, because the
  systems they'd describe don't exist yet): `ruleset_version`,
  `provider_catalog_version`, `analysis_configuration`,
  `typescript_version_used`. Adding them now would be fake data — see the
  PROPOSED section below for what they were expected to eventually cover.

  **Status model**: only `'pending' | 'running' | 'completed' | 'failed'`
  exist in the type, matching the general run lifecycle — not a
  Patchwork-wide status enum, and no patch/verification/PR states live
  here. `'failed'` became genuinely reachable in this slice: if resolving
  the commit SHA fails, the request still fails closed with no snapshot and
  no run row (see Idempotency below, unchanged from the prior slice); but
  once the snapshot is recorded, a subsequent archive-acquisition or
  evidence-collection failure produces a real `'failed'` run (no
  `analysis_evidence` row) rather than discarding that a trigger happened.
  `'pending'`/`'running'` remain unreached — the whole operation is
  computed synchronously, then written once with its final status, so no
  interim write ever occurs (see "Analysis-run lifecycle" below).

- **`analysis_evidence`** — deterministic Stripe/TypeScript applicability
  evidence collected for one `AnalysisRun` — never a decision about
  whether any change affects the repository (that's a future
  `ImpactAssessment`'s job). `analysis_run_id` references
  `analysis_runs.id`, **unique**, **`ON DELETE CASCADE`** (evidence without
  its run is meaningless) — at most one row per run. `schema_version`
  (currently `1`) lets the JSON shape evolve without a destructive
  migration; `evidence` is a zod-validated JSON blob (see
  `apps/api/src/analysis/evidence/types.ts`) rather than a normalized
  `Dependency`/`ApiUsage` relational model — deliberately deferred per the
  research correction below as premature schema commitment. A row is only
  ever written together with its run inside the same transaction when
  `status = 'completed'`; a `'failed'` run never has one — no partially
  written state is ever observable.

### Analyzer version

`ANALYZER_VERSION` (`apps/api/src/analysis/version.ts`) is a hardcoded,
manually-bumped string constant — not our own git commit SHA (changes on
every unrelated change, e.g. a docs edit, so doesn't track "did the
analyzer change") and not `package.json`'s version (pinned at `0.0.0`, no
release process bumps it). `v0`: snapshot/run creation only, no repository
content read. `v1` (current): adds archive acquisition and Stripe/
TypeScript applicability evidence collection — a real behavior change.

### Analysis-run lifecycle

`POST /repositories/:id/analyses` computes the full outcome synchronously
before writing anything about the run: resolve SHA (fail closed, unchanged
from the prior slice) → upsert snapshot → attempt archive download +
evidence collection → insert exactly one `analysis_runs` row with its
**final** status, plus an `analysis_evidence` row if and only if that
status is `'completed'`, all in one transaction. There is deliberately no
interim `'running'` database write — the "no misleading partial state"
property holds trivially because no partial state is ever written, not
because of extra bookkeeping.

### RepositorySnapshot/AnalysisRun idempotency

- `repository_snapshots` is upserted via the `(repository_id, commit_sha)`
  unique index + Drizzle `.onConflictDoUpdate` — scanning the same
  repository at the same commit SHA any number of times converges to one
  row (`ref`/`acquisition_method` refreshed on conflict). This is a
  **per-repository** unique constraint, not a global unique on `commit_sha`
  alone — two unrelated repositories can coincidentally (or via a fork)
  share a commit SHA.
- `analysis_runs` is **not** deduplicated — every successful trigger
  inserts a new row. It represents one execution/audit event ("I attempted
  to analyze this snapshot"), not an idempotent resource; multiple runs can
  legitimately point at the same snapshot, each with its own
  `analysis_evidence` row.
- **SHA-resolution failures still fail closed**: if resolving the commit
  SHA fails (GitHub API error, repository no longer accessible, malformed
  response), **no snapshot and no run row is written at all** — same
  no-partial-write convention as the install callback (see
  [docs/github-integration.md](github-integration.md)).
- **Archive/evidence-collection failures record a `'failed'` run instead**:
  once the snapshot is valid and recorded, a subsequent failure (archive
  download error, extraction error) no longer discards the fact that a
  trigger happened — it produces a `analysis_runs` row with
  `status = 'failed'` and no `analysis_evidence` row. This is a
  deliberate difference from SHA resolution: the snapshot is real and
  worth keeping regardless of whether evidence collection succeeded.

See `apps/api/src/analysis/persistence.ts` and
`apps/api/src/routes/analyses.ts` (`POST /repositories/:id/analyses`) for
the implementation.

## Candidate domain concepts (PROPOSED — not implemented)

None of what follows is implemented. This section was revised following
external technical/product research (see
[docs/adr/](adr/) for whether that research warrants its own ADR) that
corrected two structural assumptions in the original candidate list — those
corrections are called out explicitly below rather than silently applied.

### RepositorySnapshot + AnalysisRun: remaining fields (PROPOSED)

The core of this model — `repository_snapshots` and `analysis_runs`, tied
to an exact commit SHA rather than a mutable "latest" pointer — is now
**CURRENT** (see above). What follows is the part still not implemented:
`AnalysisRun` eventually referencing

- `ruleset_version`
- `provider_catalog_version`
- `analysis_configuration`
- `typescript_version_used`
- `coverage_report` (programs loaded, unresolved modules, type errors,
  dynamic construction encountered — see "Analysis coverage" below)

none of which exist as columns today, since the systems they'd describe
(rules, a provider catalog, real TypeScript analysis) don't exist yet.

**Do not treat an `ImpactAssessment` as timeless truth about a commit
SHA.** It is truth about `(RepositorySnapshot, AnalysisRun)` — re-running
analysis with a newer analyzer/ruleset against the _same_ SHA is expected
to sometimes produce a different, and more correct, result.

```
RepositorySnapshot 1 ── * AnalysisRun
ProviderChange      1 ── * ImpactAssessment
AnalysisRun         1 ── * ImpactAssessment
```

### Version applicability is evidence, not one repository field (CURRENT for InstalledSdkEvidence/ClientVersionEvidence; correction from the original candidate model)

The original candidate model implied a single, repository-level Stripe API
version. **That was wrong and was not implemented.** "This repository uses
`stripe-node` version X" does not fully determine which Stripe contract a
given usage actually experiences — API version, account default version,
and webhook version can all differ within a single repository (and can
differ per package in a monorepo, or per configured client). `stripe-node`'s
TypeScript definitions represent the SDK's _current_ supported API shape;
Stripe explicitly warns that older API versions are not accurately
represented by those definitions. No repository-level `stripe_version` or
`stripe_api_version` field exists anywhere in this schema.

Applicability evidence is collected per snapshot/usage context, as a
`StripeEvidence` JSON blob (`apps/api/src/analysis/evidence/types.ts`,
persisted in `analysis_evidence.evidence`, zod-validated on write):

- **`InstalledSdkEvidence[]` (CURRENT)** — one entry per workspace/package
  that directly declares a `stripe` dependency: `packageName`,
  `workspacePath`, `manifestPath`, `dependencyField`, `declaredRange`,
  `resolvedVersion`, `resolutionStatus`
  (`EXACT | DECLARED_ONLY | CONFLICTING | UNKNOWN`), `evidenceSources`.
  Never collapsed to one repository-wide value — a monorepo with Stripe in
  multiple packages, or at different versions, produces multiple entries.
  Resolved against `package-lock.json` and `pnpm-lock.yaml` only (see
  `docs/github-integration.md`); `yarn.lock` is recognized but not parsed,
  falling back to `DECLARED_ONLY`. Transitive (non-direct) `stripe`
  installs are not evidenced.
- **`ClientVersionEvidence[]` (CURRENT, narrower than `SdkApiVersionEvidence`
  above implied)** — one entry per `new Stripe(secret, { apiVersion })`
  construction found via AST parsing (`ts.createSourceFile`, not a
  type-checked `Program`): `workspacePath`, `sourceFile`, `line`,
  `apiVersion`, `valueKind` (`LITERAL | LOCAL_CONSTANT | DYNAMIC_UNKNOWN`).
  Only a same-file `const` with a string-literal initializer is resolved
  as `LOCAL_CONSTANT`; anything else (env vars, imported constants,
  function calls, ternaries) is `DYNAMIC_UNKNOWN` with `apiVersion: null`
  — never guessed.
- **`AccountVersionEvidence` (CURRENT, but a static stub)** — always
  `{ status: 'UNKNOWN', reason: '...' }`. No Stripe API is ever called.
- **`WebhookVersionEvidence` (CURRENT, but a static stub)** — always
  `{ status: 'OUT_OF_SCOPE', reason: '...' }`. No webhook configuration is
  analyzed.
- **`AnalysisCoverage` (CURRENT)** — `archiveAcquired`,
  `manifestsDiscovered`, `workspaceConfigDiscovered`,
  `lockfilesDiscovered/Parsed/Unsupported`, `sourceFilesScanned`,
  `sourceFilesTruncated`, `parseFailures` — distinguishes "we looked and
  found nothing" from "we couldn't fully look."

**`UNKNOWN` (and `DECLARED_ONLY`/`CONFLICTING`) is a valid, expected
outcome for every one of these**, not an error state. A repository can
legitimately have unresolvable version evidence, and that has to flow into
the tri-state assessment (see [impact-analysis.md](impact-analysis.md))
rather than being silently assumed away.

This may eventually become a `VersionContext` abstraction attached to a
specific usage rather than a snapshot-wide value (**PROPOSED, not
implemented**) — the current `StripeEvidence` JSON blob is not that
abstraction, just the discoverable evidence it would eventually draw from.

### Splitting what `ChangeRule` was implied to be (PROPOSED — correction)

The original model treated `ChangeRule` as one undifferentiated "rule."
That combines responsibilities that need to stay separable: **a change can
be reliably detectable but not safely auto-fixable**, and that distinction
must be first-class data, not something inferred from application logic.

```
ProviderChange
  ├── ApplicabilityConstraint[]   (does this change apply to this SDK/API/
  │                                 account/product version at all?)
  ├── ImpactPredicate[]           (does specific source code actually use
  │                                 the affected surface?)
  ├── MigrationRequirement[]      (what needs to change, in prose/structured
  │                                 form, independent of whether it's
  │                                 automatable)
  ├── TransformationRecipe[]?     (optional — only present when a safe,
  │                                 mechanical or bounded-AI transform
  │                                 exists)
  └── VerificationExpectation[]?  (optional — only present when a
                                    meaningful independent postcondition
                                    can be stated)
```

A `ProviderChange` may legitimately have high detectability, low
fixability, and only partial verifiability — that should be visible in the
data, e.g.:

```
detectability   HIGH
fixability      LOW
verifiability   MEDIUM
```

This whole bundle (the constraints/predicates/requirements derived from one
`ProviderChange`) should eventually be versioned and immutable once an
`ImpactAssessment` references it — rules are effectively a software supply
chain: a bad rule produces incorrect findings across every repository that
references it. The external research materials call this versioned,
immutable bundle a `RuleVersion`; we keep referring to it here as the
(now-structured) `ChangeRule` concept since both name the same
not-yet-designed idea — this is not a decision to introduce a differently
named entity, just a note that the two names refer to the same thing.

**Do not over-design a universal cross-provider ontology yet.** Generic
primitives (member access on an external API path, argument property,
literal value, call target, type-domain membership) are expected to port
across providers; complex provider-specific concepts (e.g. a Stripe
metered-billing migration's transition state) should stay behind a
provider-specific escape hatch rather than being forced into a generic
shape prematurely.

### Do not persist a large `ApiUsage` table yet (dependency/version evidence now CURRENT via `analysis_evidence`; the rest still PROPOSED — correction)

This was premature schema commitment when originally written. For the
initial product, persist:

- snapshot identity (`RepositorySnapshot`) — **CURRENT**
- dependency/version evidence (see above) — **CURRENT**, as the
  `analysis_evidence.evidence` JSON blob, not a normalized relational
  model — the correction below still applies to this evidence: it stays a
  schema-validated JSON document, not a `Dependency`/`ApiUsage` table.
- analysis coverage (`AnalysisCoverage`, part of `StripeEvidence` above) —
  **CURRENT**
- `ImpactAssessment`s — **PROPOSED**
- findings/evidence spans (`AffectedLocation` / "Finding" — the specific
  file/line/usage an assessment points to)
- analyzer/rule versions

The intermediate, complete API-usage graph (every resolved symbol/call in a
snapshot, not just the ones relevant to a specific `ProviderChange`) should
stay a recomputable, in-memory, or artifact-based representation until real
query patterns prove it deserves a table. Similarly, `Dependency` may start
as an immutable inventory attached to one `AnalysisRun`, not a globally
normalized, cross-snapshot business entity.

### Full candidate list

`User`, `GitHubInstallation`, `Repository`, `RepositorySnapshot`,
`AnalysisRun` (all now CURRENT, as `users`, `github_installations`,
`repositories`, `repository_snapshots`, `analysis_runs` above),
`ProviderChange`, `ChangeRule` (structured as above), `Dependency`,
`ImpactAssessment`, `AffectedLocation`/Finding, `PatchAttempt`,
`VerificationRun`, `PullRequest`, `AuditEvent`. See
[CLAUDE.md](../CLAUDE.md#product) for the core workflow these will support,
and [docs/impact-analysis.md](impact-analysis.md) for the pipeline that
produces an `ImpactAssessment`.

## Open questions

- Multi-tenancy model (row-level ownership vs. schema-per-tenant) is
  undecided — `connected_by_user_id`'s "first connector wins" behavior is a
  deliberately minimal stand-in, not a multi-tenancy design.
- Whether/how `is_active` (or an equivalent) gets added once uninstall
  detection exists.
- Retention policy for `RepositorySnapshot` source data (see
  [docs/security.md](security.md) on minimizing source-code persistence).
- Exact relationship cardinality between `ProviderChange`, the structured
  `ChangeRule`/`RuleVersion` bundle, and `ImpactAssessment` (e.g. can one
  `ImpactAssessment` span multiple rule bundles) is undecided.
- Whether/when `VersionContext` becomes its own entity versus staying
  embedded evidence on an `ImpactAssessment`.

## Deferred

`ProviderChange` through `AuditEvent` (the remainder of the candidate list
above, now that `RepositorySnapshot`, `AnalysisRun`, and the evidence
subset above are implemented) require their own design pass once the
impact-analysis vertical slice is scoped. Full repository-content
persistence remains deferred: an exact-SHA archive is downloaded and
extracted per analysis, but only ever to an OS temp directory deleted
immediately after evidence collection (`apps/api/src/analysis/archive.ts`)
— no source file content is ever persisted to PostgreSQL, only the
structured evidence derived from it.
