import {
  bigint,
  boolean,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Deliberately minimal table used to prove that migrations run, the
 * application can connect to PostgreSQL, and integration tests have a
 * real table to exercise. Not part of the eventual product data model.
 */
export const appMetadata = pgTable(
  'app_metadata',
  {
    id: serial('id').primaryKey(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('app_metadata_key_idx').on(table.key)],
);

/**
 * A Patchwork user, identified by their GitHub account. github_user_id is
 * the identity anchor (immutable); github_login is a cached display value
 * only, since GitHub logins can be renamed.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    githubUserId: bigint('github_user_id', { mode: 'number' }).notNull(),
    githubLogin: text('github_login').notNull(),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_github_user_id_idx').on(table.githubUserId)],
);

/**
 * A Patchwork browser session. token_hash is the SHA-256 hash of the random
 * token sent to the browser in an HttpOnly cookie — the raw token is never
 * stored, so a database read alone cannot yield a usable session.
 */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

/**
 * An installation of the Patchwork GitHub App on a user or organization
 * account. github_installation_id is the identity anchor. connected_by_user_id
 * records who connected it — not full ownership: if a second Patchwork user
 * completes a callback for an installation that already exists, ownership is
 * NOT reassigned ("first connector wins"). There is no multi-user/team access
 * model yet; this is an intentional limitation, not an oversight.
 *
 * is_active is deliberately omitted: nothing in this slice sets or reads it,
 * since uninstall detection (webhook or refresh) doesn't exist yet.
 */
export const githubInstallations = pgTable(
  'github_installations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    githubInstallationId: bigint('github_installation_id', { mode: 'number' }).notNull(),
    accountType: text('account_type').notNull(),
    accountId: bigint('account_id', { mode: 'number' }).notNull(),
    accountLogin: text('account_login').notNull(),
    connectedByUserId: uuid('connected_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('github_installations_installation_id_idx').on(table.githubInstallationId),
  ],
);

/**
 * A repository granted to a Patchwork installation. github_repository_id is
 * globally unique on GitHub regardless of which installation currently has
 * access to it, so it (not owner/name, which can be renamed) is the identity
 * anchor.
 */
export const repositories = pgTable(
  'repositories',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    githubRepositoryId: bigint('github_repository_id', { mode: 'number' }).notNull(),
    installationId: uuid('installation_id')
      .notNull()
      .references(() => githubInstallations.id, { onDelete: 'cascade' }),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    isPrivate: boolean('is_private').notNull(),
    defaultBranch: text('default_branch').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('repositories_github_repository_id_idx').on(table.githubRepositoryId)],
);

/**
 * An immutable snapshot of a repository's source identity at one exact
 * commit — never a mutable branch pointer. (repository_id, commit_sha) is
 * unique (not commit_sha alone: two unrelated repositories can share a
 * commit hash via fork/coincidence). Describes source identity only, not
 * analysis results — see analysisRuns.
 */
export const repositorySnapshots = pgTable(
  'repository_snapshots',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    ref: text('ref').notNull(),
    acquisitionMethod: text('acquisition_method').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('repository_snapshots_repo_sha_idx').on(table.repositoryId, table.commitSha),
  ],
);

/**
 * One execution of Patchwork's analyzer against one RepositorySnapshot.
 * Kept separate from RepositorySnapshot deliberately: the same commit SHA
 * can legitimately be analyzed again later with a different
 * analyzer/ruleset version and produce a different result — an
 * ImpactAssessment (future) is truth about this pair, not about the SHA
 * alone. Not deduplicated: each trigger is its own execution/audit record,
 * not an idempotent resource, so multiple runs may point at the same
 * snapshot.
 *
 * ruleset_version, provider_catalog_version, analysis_configuration,
 * typescript_version_used, and coverage_report are deliberately omitted:
 * none of those systems (rules, provider catalog, real TypeScript
 * analysis) exist yet, so those fields would be fake. `created_at` is also
 * omitted -- started_at already serves that purpose here.
 */
export const analysisRuns = pgTable('analysis_runs', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  repositorySnapshotId: uuid('repository_snapshot_id')
    .notNull()
    .references(() => repositorySnapshots.id, { onDelete: 'restrict' }),
  triggeredByUserId: uuid('triggered_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  analyzerVersion: text('analyzer_version').notNull(),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
