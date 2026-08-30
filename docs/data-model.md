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

Everything below remains a future concept only, unchanged by this slice:
`RepositorySnapshot`, `Dependency`, `ApiUsage`, `ProviderChange`,
`ChangeRule`, `ImpactAssessment`, `AffectedLocation`, `PatchAttempt`,
`VerificationRun`, `PullRequest`, `AuditEvent`. See
[CLAUDE.md](../CLAUDE.md#product) for the core workflow these will support,
and [docs/impact-analysis.md](impact-analysis.md) for the conceptual
separation between `ProviderChange`, `ChangeRule`, `RepositorySnapshot`,
and `ImpactAssessment`.

## Open questions

- Multi-tenancy model (row-level ownership vs. schema-per-tenant) is
  undecided — `connected_by_user_id`'s "first connector wins" behavior is a
  deliberately minimal stand-in, not a multi-tenancy design.
- Whether/how `is_active` (or an equivalent) gets added once uninstall
  detection exists.
- Retention policy for `RepositorySnapshot` source data (see
  [docs/security.md](security.md) on minimizing source-code persistence) —
  still entirely future, `RepositorySnapshot` doesn't exist yet.

## Deferred

`RepositorySnapshot` through `AuditEvent` (the list above) require their
own design pass once the impact-analysis vertical slice is scoped.
