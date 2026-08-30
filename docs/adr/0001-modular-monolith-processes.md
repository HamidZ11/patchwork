# ADR-001: TypeScript modular monolith with separate web, API, and worker processes

## Status

Accepted

## Context

Patchwork will eventually need to: serve a frontend, expose an API, and run
background work (scanning repositories, running impact analysis, generating
and verifying patches, opening PRs). That background work is naturally
asynchronous and potentially slow (minutes, not milliseconds), so it cannot
live inside HTTP request handlers.

The product is pre-revenue and pre-scale: there are no customers, no proven
load profile, and the core hard problem (impact analysis) hasn't been
designed yet. The team is small. The immediate need is a codebase that is
easy to reason about, cheap to change, and doesn't force premature
distributed-systems complexity.

## Decision

Use a single TypeScript codebase (pnpm workspace) organized as a **modular
monolith**, split into three independently runnable processes:

- `apps/web` — Next.js frontend
- `apps/api` — Fastify HTTP API
- `apps/worker` — long-running Node process for background jobs

All three share code through internal workspace packages (`packages/config`,
`packages/db`) rather than through network calls or duplicated logic. There
is one database (PostgreSQL) and no message broker yet.

## Alternatives considered

- **Single process (API does everything, including background work inline)**
  — rejected because repository scanning, impact analysis, and verification
  are expected to be slow and should not block HTTP request handlers or risk
  timing out a request.
- **Microservices per domain (github-service, stripe-service,
  impact-service, patch-service, ...)** — rejected. The domain boundaries
  aren't known yet; impact analysis (the hard problem) hasn't been designed.
  Splitting into services now would mean guessing boundaries, paying network
  and deployment overhead, and making refactors across services expensive,
  for a product with no users yet.
- **Serverless functions per concern** — rejected for similar reasons, plus
  background jobs here are expected to be longer-running than typical
  serverless execution limits comfortably support.

## Consequences

- Fast iteration: one codebase, one `pnpm install`, one CI pipeline, shared
  types across API and worker.
- Deployment simplicity: three processes to run, not N services to
  orchestrate.
- The worker and API must still be deployed/scaled independently in
  production (they are separate processes today, not separate deploy
  targets), which is deferred until there's a real load profile to design
  against.
- If a genuine scaling or team-ownership boundary emerges later (e.g. impact
  analysis needs isolated, heavier compute), that logic can be extracted from
  `apps/worker` into its own service without restructuring the rest of the
  system, because it already sits behind a process boundary and internal
  package boundaries.

## Why not microservices

Microservices pay for themselves when there are independent teams, independent
scaling needs, or independent deployment cadences that justify the network,
operational, and consistency overhead. None of those are true here yet. The
worker process boundary already gives us the one separation that matters
today (synchronous HTTP vs. asynchronous background work) without paying for
service discovery, distributed tracing, or cross-service versioning this
early.
