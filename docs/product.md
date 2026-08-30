# Product

## Problem

Discovering that a third-party API has changed, determining whether that
change actually matters to a specific codebase, locating the affected
usages, understanding what migration is required, implementing the change,
and validating it is currently fragmented and largely manual. Teams rely on
changelogs, tribal knowledge, and often only find out a change mattered when
something breaks. This is not just "we found out too late" — every step in
that chain (discovery → relevance → location → migration → validation) is
separately manual today.

## Target user

Engineering teams (initially small-to-mid TypeScript teams) with a
dependency on a third-party API (initially Stripe) integrated into a GitHub
repository, who currently track that dependency's changes manually.

## Core promise

When the API you depend on changes in a way that affects your code,
Patchwork tells you exactly where, why, and proposes a minimal, verified fix
as a pull request — instead of you finding out later.

## MVP

- GitHub only (source control and PR delivery)
- Stripe only (the tracked third-party API)
- TypeScript repositories only
- `stripe-node` only
- One repository at a time
- Breaking changes and deprecations only (not additive/non-breaking changes)

## Non-goals (for now)

- Multi-provider support (APIs beyond Stripe, languages beyond TypeScript).
- Multi-repository or org-wide scanning.
- Any UI beyond the placeholder homepage.
- Autonomously merging generated PRs.
- General-purpose dependency upgrades (that's Dependabot's job — see below).

## Core workflow

```
external API change
  → normalize change
  → determine applicable repositories
  → locate affected usages
  → assess impact
  → explain evidence
  → generate minimal patch
  → verify patch
  → create GitHub PR
```

## Why this differs from Dependabot

Dependabot (and similar tools) tell you a dependency has a new version
available and can bump the version number. They don't know whether the new
version actually changes behavior your code relies on, don't locate the
specific call sites affected, and don't produce a migration — updating the
version is the customer's problem the moment it introduces a breaking
change. Patchwork's version bump is a side effect, not the goal: the goal is
determining actual impact on your code and handing you a working migration,
not just a diff of a changelog.

## Success criteria

Not yet formally defined pending the first vertical slice. At minimum, for
the MVP to be worth using over manually reading Stripe's changelog:

- Low false-negative rate on real breaking changes that affect a test
  repository (missing a real break defeats the purpose).
- Low enough false-positive rate that generated PRs are trusted, not
  ignored.
- Generated patches are minimal and reviewable, not sweeping rewrites.

## Open questions

- How customers connect a repository (GitHub App vs. OAuth vs. manual
  token) — see [docs/github-integration.md](github-integration.md).
- Pricing and packaging.
- How much human review is required before a PR is opened automatically.
- Precise, measurable success thresholds (see
  [docs/impact-analysis.md](impact-analysis.md) for the evaluation
  approach).

## Deferred

This document describes product intent, not the current implementation
state. See [docs/architecture.md](architecture.md) for what is actually
built today.
