import {
  bigint,
  boolean,
  integer,
  jsonb,
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

/**
 * Deterministic Stripe/TypeScript applicability evidence collected for one
 * AnalysisRun -- not a decision about whether any change affects the
 * repository (that's a future ImpactAssessment's job). One optional row per
 * run: a run can legitimately have none (status='failed', or a
 * pre-evidence-slice historical row). ON DELETE CASCADE from analysis_runs
 * -- evidence without its run is meaningless. `evidence` is a
 * zod-validated JSON blob (see analysis/evidence/types.ts) rather than a
 * normalized Dependency/ApiUsage relational model -- deliberately deferred
 * per docs/data-model.md's research correction as premature schema
 * commitment. `schema_version` lets the shape evolve without a destructive
 * migration.
 */
export const analysisEvidence = pgTable('analysis_evidence', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  analysisRunId: uuid('analysis_run_id')
    .notNull()
    .unique()
    .references(() => analysisRuns.id, { onDelete: 'cascade' }),
  schemaVersion: integer('schema_version').notNull(),
  evidence: jsonb('evidence').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A normalized, provider-issued API change -- the fact of what changed,
 * independent of how Patchwork checks whether it applies. Not
 * user-authored: populated via an idempotent upsert from one hardcoded
 * definition per real, manually-verified change (see
 * analysis/provider-changes/). external_id is a stable slug (currently
 * matching the source changelog's URL segment) so re-running the upsert
 * converges to one row.
 */
export const providerChanges = pgTable(
  'provider_changes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    sourceUrl: text('source_url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('provider_changes_external_id_idx').on(table.externalId)],
);

/**
 * One versioned, immutable check of whether/how a ProviderChange applies
 * -- the rule bundle. predicate_kind is a code discriminator (which
 * hardcoded predicate function to run), not a general rule-authoring DSL.
 * migration_requirement is Stripe's own verbatim migration text, not
 * Patchwork-authored prose. Versioned like ANALYZER_VERSION: a future
 * bugfix bumps `version` rather than silently rewriting what an existing
 * ImpactAssessment meant.
 */
export const ruleVersions = pgTable(
  'rule_versions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    providerChangeId: uuid('provider_change_id')
      .notNull()
      .references(() => providerChanges.id, { onDelete: 'restrict' }),
    version: text('version').notNull(),
    predicateKind: text('predicate_kind').notNull(),
    migrationRequirement: text('migration_requirement').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('rule_versions_change_version_idx').on(table.providerChangeId, table.version),
  ],
);

/**
 * Truth about one (AnalysisRun, RuleVersion) pair -- never about a commit
 * SHA alone (the same snapshot can be re-evaluated by a newer RuleVersion
 * and legitimately produce a different result). Unlike AnalysisRun
 * (an execution/audit log, deliberately not deduplicated), an
 * ImpactAssessment is a pure function of two already-immutable inputs, so
 * `(analysis_run_id, rule_version_id)` is unique and upserted -- re-running
 * the identical evaluation converges to one row rather than accumulating
 * duplicates. `status` is AFFECTED | NOT_AFFECTED | UNCERTAIN; `reason` is
 * a short human-readable summary; `coverage` is small structured JSON
 * (workspace-level applicability breakdown, ambiguous references, load
 * failures) -- not raw source, no natural per-row identity of its own.
 * ON DELETE RESTRICT from both analysis_runs and rule_versions -- an
 * assessment is a historical record that shouldn't silently vanish.
 */
export const impactAssessments = pgTable(
  'impact_assessments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    analysisRunId: uuid('analysis_run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'restrict' }),
    ruleVersionId: uuid('rule_version_id')
      .notNull()
      .references(() => ruleVersions.id, { onDelete: 'restrict' }),
    status: text('status').notNull(),
    reason: text('reason').notNull(),
    coverage: jsonb('coverage').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('impact_assessments_run_rule_idx').on(table.analysisRunId, table.ruleVersionId),
  ],
);

/**
 * A specific proven location an AFFECTED ImpactAssessment points to --
 * real rows (small, bounded: zero to a few per assessment), not a JSONB
 * blob, matching the AffectedLocation/Finding candidate table from
 * docs/data-model.md's research correction (distinct from the large,
 * deliberately-non-persisted intermediate ApiUsage graph). ON DELETE
 * CASCADE from impact_assessments -- a finding without its assessment is
 * meaningless. Re-evaluation deletes and reinserts a run's findings
 * rather than trying to diff/update individual rows.
 */
export const impactFindings = pgTable('impact_findings', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  impactAssessmentId: uuid('impact_assessment_id')
    .notNull()
    .references(() => impactAssessments.id, { onDelete: 'cascade' }),
  workspacePath: text('workspace_path').notNull(),
  sourceFile: text('source_file').notNull(),
  line: integer('line').notNull(),
  matchedSymbol: text('matched_symbol').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
