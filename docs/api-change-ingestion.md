# API Change Ingestion

Four manually-normalized real Stripe changes are now implemented (see
below). Automated ingestion infrastructure remains not implemented — this
document records decisions made ahead of that future slice, and what's
still open.

## Current (CURRENT)

- **Four manually normalized real Stripe changes are encoded**, not a
  fully automated ingestion pipeline — chosen for materially different
  shapes (method-call removal, response-property relocation,
  request-argument-property removal, literal-domain split) and two
  different applicability boundaries, each sourced directly from Stripe's
  own changelog and cross-verified against the real `stripe-node` source
  at specific tags — never paraphrased from a third-party summary. See
  [impact-analysis.md](impact-analysis.md#rules-implemented-current) for
  the full provenance of all four, and
  [data-model.md](data-model.md#splitting-what-changerule-was-implied-to-be-applicabilityconstraintimpactpredicatemigrationrequirement-now-current-across-four-encoded-rules-transformationrecipeverificationexpectation-still-proposed--correction)
  for the `ProviderChange`/`RuleVersion` schema they normalize into.
- Each normalized `ProviderChange` is a hardcoded TypeScript definition
  under `apps/api/src/analysis/impact/rules/` (one file per rule),
  registered in `registry.ts`'s `IMPACT_RULES`, persisted via an
  idempotent upsert into `provider_changes`/`rule_versions` — not raw
  provider text passed into impact analysis, and not an admin-authored or
  ingested row.
- `ApplicabilityConstraint`/`ImpactPredicate` for all four changes are
  deterministic code, built from one shared, parameterized
  `computeApplicability(evidence, config)`
  (`apps/api/src/analysis/impact/applicability.ts`) and three reusable
  predicate primitives (`apps/api/src/analysis/impact/predicates/
{member-access,call-argument-property,literal-comparison}.ts`),
  identified by each rule's `rule_versions.predicate_kind` — not yet data
  a rule-authoring surface could edit (see data-model.md's open question
  on whether that becomes necessary as more rules are added).
- **A controlled, hand-labelled benchmark corpus now exists**
  (`apps/api/src/benchmark/`) measuring whether this manually-encoded
  approach actually generalizes across rule shapes — see
  [impact-analysis.md](impact-analysis.md#evaluation-approach-current--controlled-benchmark-real-historical-pairs-still-proposed).
  This is evaluation infrastructure, not ingestion — the four
  `ProviderChange`s themselves are still hand-authored, not derived from
  the benchmark.

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
  [data-model.md](data-model.md#splitting-what-changerule-was-implied-to-be-applicabilityconstraintimpactpredicatemigrationrequirement-now-current-across-four-encoded-rules-transformationrecipeverificationexpectation-still-proposed--correction)
  for the full breakdown and why a single undifferentiated `ChangeRule`
  isn't sufficient: a change can be reliably detectable but not safely
  auto-fixable, and that distinction needs to survive into the data.
- The **first several slices use manually normalized real Stripe changes**
  (four now, see "Current" above) rather than a fully automated ingestion
  pipeline — this has now been proven out across materially different
  shapes, not just one. Automated ingestion for additional changes remains
  a separate, later concern.

## Open questions

- Source of truth once automated: changelog diffing, OpenAPI spec diffing,
  or type-definition diffing against `stripe-node` releases (or some
  combination).
- Polling cadence vs. event-driven ingestion, once automated.
- How a `RuleVersion` is authored from a `ProviderChange` for a rule
  beyond these first four — manually (as all four so far were), assisted,
  or generated — is undecided. Four manual rules sharing three predicate
  primitives is not yet strong evidence either way.

## Deferred

Automated ingestion infrastructure for additional changes. `apps/worker`
exists as the future home for this, but performs no ingestion logic today.
