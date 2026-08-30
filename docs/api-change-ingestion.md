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
  separate from `ChangeRule` (a deterministic, evaluable rule derived from
  that change, used to check whether it applies to a given repository) —
  see [data-model.md](data-model.md) for the full explanation.
- The **first end-to-end slice may use manually normalized real Stripe
  changes** (hand-written `ProviderChange`/`ChangeRule` records for a small
  set of real, verified Stripe breaking changes) rather than a fully
  automated ingestion pipeline. Automated ingestion is a separate, later
  concern — proving impact analysis works matters more first than
  automating the input to it.

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
