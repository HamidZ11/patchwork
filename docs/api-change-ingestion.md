# API Change Ingestion

The one manually-normalized real Stripe change is now implemented (see
below). Automated ingestion infrastructure remains not implemented — this
document records decisions made ahead of that future slice, and what's
still open.

## Current (CURRENT)

- **One manually normalized real Stripe change is encoded**, not a fully
  automated ingestion pipeline: Stripe's Basil-release replacement of the
  Upcoming Invoice API (`stripe.invoices.retrieveUpcoming` →
  `stripe.invoices.createPreview`), sourced directly from Stripe's own
  changelog
  ([`docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations`](https://docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations))
  and cross-verified against the real `stripe-node` source — not
  paraphrased from a third-party summary. See
  [impact-analysis.md](impact-analysis.md#first-candidate-rule-current--implemented)
  for the full provenance and
  [data-model.md](data-model.md#splitting-what-changerule-was-implied-to-be-applicabilityconstraintimpactpredicatemigrationrequirement-now-current-for-the-one-encoded-rule-transformationrecipeverificationexpectation-still-proposed--correction)
  for the `ProviderChange`/`RuleVersion` schema this normalizes into.
- The normalized `ProviderChange` is a hardcoded TypeScript definition
  (`apps/api/src/analysis/impact/stripe-basil-invoice-preview.ts`),
  persisted via an idempotent upsert into `provider_changes`/
  `rule_versions` — not raw provider text passed into impact analysis, and
  not an admin-authored or ingested row.
- `ApplicabilityConstraint`/`ImpactPredicate` for this one change are
  deterministic code (`apps/api/src/analysis/impact/{applicability,
predicate}.ts`), identified by `rule_versions.predicate_kind` — not yet
  data a rule-authoring surface could edit (see data-model.md's open
  question on whether that becomes necessary once a second rule exists).

## Decided (DECIDED BUT NOT IMPLEMENTED — automated ingestion)

- Stripe only initially, ingested via official sources (Stripe's own
  changelog/release notes/API version history), not third-party summaries.
- Every ingested change is normalized into Patchwork's own representation —
  a `ProviderChange` — before anything downstream touches it. Raw provider
  text/data is not passed directly into impact analysis.
- `ProviderChange` (the normalized fact of what changed) is conceptually
  separate from the rule bundle derived from it — `ApplicabilityConstraint`,
  `ImpactPredicate`, `MigrationRequirement`, and the optional
  `TransformationRecipe`/`VerificationExpectation` — used to check whether
  and how it applies to a given repository. See
  [data-model.md](data-model.md#splitting-what-changerule-was-implied-to-be-applicabilityconstraintimpactpredicatemigrationrequirement-now-current-for-the-one-encoded-rule-transformationrecipeverificationexpectation-still-proposed--correction)
  for the full breakdown and why a single undifferentiated `ChangeRule`
  isn't sufficient: a change can be reliably detectable but not safely
  auto-fixable, and that distinction needs to survive into the data.
- The **first end-to-end slice uses exactly one manually normalized real
  Stripe change** (see "Current" above) rather than a fully automated
  ingestion pipeline or a broad first set — this has now been proven out.
  Automated ingestion for additional changes remains a separate, later
  concern.

## Open questions

- Source of truth once automated: changelog diffing, OpenAPI spec diffing,
  or type-definition diffing against `stripe-node` releases (or some
  combination).
- Polling cadence vs. event-driven ingestion, once automated.
- How a `RuleVersion` is authored from a `ProviderChange` for a _second_
  rule — manually (as this first one was), assisted, or generated — is
  undecided.

## Deferred

Automated ingestion infrastructure for additional changes. `apps/worker`
exists as the future home for this, but performs no ingestion logic today.
