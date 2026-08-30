# API Change Ingestion

Not yet implemented. This records decisions made ahead of the implementation
slice, and what's still open.

## Decided (DECIDED BUT NOT IMPLEMENTED)

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
  [data-model.md](data-model.md#splitting-what-changerule-was-implied-to-be-proposed--correction)
  for the full breakdown and why a single undifferentiated `ChangeRule`
  isn't sufficient: a change can be reliably detectable but not safely
  auto-fixable, and that distinction needs to survive into the data.
- The **first end-to-end slice should use exactly one manually normalized
  real Stripe change** (a hand-written `ProviderChange` plus its rule
  bundle for one real, verified Stripe breaking change — see
  [impact-analysis.md](impact-analysis.md#first-candidate-rule-proposed) for
  which one) rather than a fully automated ingestion pipeline or a broad
  first set. Automated ingestion is a separate, later concern — proving
  impact analysis works on one real change matters more first than
  automating the input to it, or than covering many changes at once.

## Open questions

- Source of truth once automated: changelog diffing, OpenAPI spec diffing,
  or type-definition diffing against `stripe-node` releases (or some
  combination).
- Polling cadence vs. event-driven ingestion, once automated.
- How a `ChangeRule` is authored from a `ProviderChange` — manually,
  assisted, or generated — is undecided.

## Deferred

Automated ingestion infrastructure. `apps/worker` exists as the future home
for this, but performs no ingestion logic today.
