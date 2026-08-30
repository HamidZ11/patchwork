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
```

No join table for user↔repository access exists yet — access is entirely
mediated through "which installation did this user connect," and there is
no multi-user-per-installation sharing model in this slice.

## Candidate domain concepts (PROPOSED — not implemented)

None of what follows is implemented. This section was revised following
external technical/product research (see
[docs/adr/](adr/) for whether that research warrants its own ADR) that
corrected two structural assumptions in the original candidate list — those
corrections are called out explicitly below rather than silently applied.

### RepositorySnapshot + AnalysisRun (PROPOSED)

**`RepositorySnapshot`** is tied to an exact commit SHA — an immutable
source boundary, acquired via GitHub's commit-specific archive endpoint
(Contents read access), not a mutable "latest" pointer.

A commit SHA alone does **not** make an assessment reproducible, though.
Two Patchwork versions can legitimately reach different conclusions on the
same SHA after a rule or analyser bug is fixed. That reproducibility
concern is a **separate concept**, `AnalysisRun`, referencing:

- `repository_snapshot_id`
- `analyzer_version`
- `ruleset_version`
- `provider_catalog_version`
- `analysis_configuration`
- `typescript_version_used`
- `status`
- `coverage_report` (programs loaded, unresolved modules, type errors,
  dynamic construction encountered — see "Analysis coverage" below)

**Do not treat an `ImpactAssessment` as timeless truth about a commit
SHA.** It is truth about `(RepositorySnapshot, AnalysisRun)` — re-running
analysis with a newer analyzer/ruleset against the _same_ SHA is expected
to sometimes produce a different, and more correct, result.

```
RepositorySnapshot 1 ── * AnalysisRun
ProviderChange      1 ── * ImpactAssessment
AnalysisRun         1 ── * ImpactAssessment
```

### Version applicability is evidence, not one repository field (PROPOSED — correction)

The original candidate model implied a single, repository-level Stripe API
version. **That is wrong and must not be implemented.** "This repository
uses `stripe-node` version X" does not fully determine which Stripe
contract a given usage actually experiences — API version, account default
version, and webhook version can all differ within a single repository
(and can differ per package in a monorepo, or per configured client).
`stripe-node`'s TypeScript definitions represent the SDK's _current_
supported API shape; Stripe explicitly warns that older API versions are
not accurately represented by those definitions.

Applicability evidence should instead be collected per snapshot/usage
context, roughly:

- `InstalledSdkEvidence` — package, exact lockfile version, owning
  workspace/package
- `SdkApiVersionEvidence` — pinned SDK API version, where recoverable
- `ClientVersionEvidence[]` — explicit `apiVersion` client configuration,
  source location, and whether it resolved to a constant, a resolvable
  expression, or is unknown
- `AccountVersionEvidence` — known / unknown, with source
- `WebhookVersionEvidence` — out-of-scope / known / unknown

**`UNKNOWN` must be a valid, expected outcome for every one of these**, not
an error state. A repository can legitimately have unresolvable version
evidence, and that has to flow into the tri-state assessment (see
[impact-analysis.md](impact-analysis.md)) rather than being silently
assumed away.

This may eventually become a `VersionContext` abstraction attached to a
specific usage rather than a snapshot-wide value — not designed yet.

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

### Do not persist a large `ApiUsage` table yet (PROPOSED — correction)

This is premature schema commitment today. For the initial product, prefer
persisting:

- snapshot identity (`RepositorySnapshot`)
- dependency/version evidence (see above)
- analysis coverage (`AnalysisRun.coverage_report`)
- `ImpactAssessment`s
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

`User`, `GitHubInstallation`, `Repository` (all now CURRENT, as `users`,
`github_installations`, `repositories` above), `RepositorySnapshot`,
`AnalysisRun`, `ProviderChange`, `ChangeRule` (structured as above),
`Dependency`, `ImpactAssessment`, `AffectedLocation`/Finding,
`PatchAttempt`, `VerificationRun`, `PullRequest`, `AuditEvent`. See
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

`RepositorySnapshot` through `AuditEvent` (the full candidate list above)
require their own design pass once the impact-analysis vertical slice is
scoped. Nothing in this document is implemented.
