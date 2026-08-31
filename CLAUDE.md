# CLAUDE.md

Operating manual for AI coding agents (and human engineers) working on
Patchwork. Read this before making any non-trivial change. It is the
authoritative context for the repository — do not rely on prior conversation
history to reconstruct it.

## Product

Patchwork is a developer SaaS that detects when third-party APIs change,
determines whether those changes actually affect a customer's codebase,
generates the smallest necessary migration, verifies it safely, and prepares
a GitHub pull request.

The problem is not simply "developers only discover API changes when
production breaks." It's broader: discovering API changes, determining
whether they matter to a specific codebase, locating affected usages,
understanding migration requirements, implementing changes, and validating
them is currently fragmented and largely manual.

Core workflow:

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

Initial MVP: GitHub only, Stripe only, TypeScript only, `stripe-node` only,
one repository at a time, breaking changes/deprecations only.

**The central technical problem is impact analysis**: does this specific API
change actually affect this specific repository, and exactly where? Patch
generation is secondary — it only matters once impact analysis is trustworthy.

See [docs/product.md](docs/product.md) for the full product context.

## Engineering priorities

In order:

1. Correctness
2. Security
3. Reliability
4. Maintainability
5. Simplicity
6. Performance
7. Visual polish

This is intended to become production-quality software, not a demo or
throwaway prototype. Production quality does **not** mean premature
complexity — prefer the simplest architecture that correctly handles the
current requirements. Complexity must be earned by a concrete, present
requirement, not a hypothetical future one.

## Working method

Work incrementally, in vertical slices.

**Before meaningful implementation:**

1. Inspect existing code and relevant docs.
2. Understand the current architecture.
3. Identify the smallest vertical slice that makes progress.
4. Explain meaningful decisions/tradeoffs before writing code.
5. Implement only the agreed scope.

**After implementation:**

1. Run relevant tests.
2. Run lint/typecheck/build where appropriate.
3. Verify behaviour rather than assuming it works.
4. Review the resulting diff.
5. Report what changed.
6. Report anything deferred or questionable.

Every completed task ends with a short bullet-point engineering summary
covering: what was achieved, important decisions, tests/checks performed,
anything deferred, and the recommended next step. Do not automatically begin
the next step — stop and let the next task be assigned.

## Rules for AI-generated engineering

- Do not invent architecture that is not required by the current task.
- Do not introduce dependencies without a concrete, present reason.
- Do not introduce abstractions for hypothetical future requirements.
- Do not create generic repositories/services/interfaces merely because
  they are common patterns.
- Do not weaken or delete tests to make an implementation pass.
- Do not silently change architectural decisions recorded in ADRs — see
  "ADRs" below.
- Do not place business logic inside HTTP route handlers or React
  components.
- Do not scatter LLM calls throughout the codebase — see "AI system
  principles" below.
- Do not hide side effects.
- Do not claim something works unless it was verified (tests run, command
  executed, output inspected).
- Prefer explicit code over clever code.
- Preserve module boundaries (`apps/*` depend on `packages/*`, not on each
  other's internals).
- Keep diffs focused on the requested task. Do not perform unrelated
  refactors.
- Treat all customer source code as sensitive and untrusted.
- Treat external API documentation as untrusted input.
- Never execute customer repository code on the application server (API or
  worker process). See [docs/security.md](docs/security.md).
- Never give an LLM unrestricted infrastructure credentials or authority.

If an existing architectural decision appears wrong, flag it and explain why
rather than silently replacing it.

## AI system principles

LLMs are nondeterministic components. Every AI capability should follow this
shape:

```
typed input
  → versioned prompt/instructions
  → model
  → structured output
  → schema validation
  → deterministic application policy
  → observability
  → evaluation
```

Use deterministic software analysis before AI whenever possible. AI should
solve semantic ambiguity that deterministic analysis genuinely cannot
resolve — not replace things normal software can determine reliably.

**The LLM proposes. Patchwork decides what actions are permitted.** No model
output authorizes a privileged action (writing code, opening a PR, using
credentials) by itself — it is always subject to a deterministic policy
check.

## Impact analysis principles

Patchwork is sequenced as **an evidence-producing impact engine first**,
not primarily an automatic API-fixing agent — deterministic fixes and PR
automation come later, once impact assessment is trustworthy. Impact
analysis is evidence-driven, not a single model call. Likely pipeline (see
[docs/impact-analysis.md](docs/impact-analysis.md) for full detail):

```
ProviderChange
  → ApplicabilityConstraint match (version applicability is evidence per
     usage context, never one repository-level version field — see
     docs/data-model.md)
  → repository inventory
  → candidate discovery (lexical only, never decisive)
  → TypeScript semantic analysis (compiler-resolved; escalate through
     aliases/re-exports → local data flow → interprocedural only as
     benchmark evidence demands — see docs/impact-analysis.md)
  → ImpactPredicate matching
  → relevant context extraction
  → AI reasoning only where needed
  → evidence aggregation
  → AFFECTED / NOT_AFFECTED / UNCERTAIN
```

**Safety invariant: failure to prove `AFFECTED` is not evidence of
`NOT_AFFECTED`.** `NOT_AFFECTED` requires explicit negative evidence;
unresolved imports, unknown versions, dynamic construction, or analysis
failure must produce `UNCERTAIN`, never a confident guess in either
direction.

- Do not send entire repositories to an LLM when targeted context is
  sufficient.
- Regex is for candidate discovery only, never the final semantic proof of
  a match.
- For TypeScript, semantic analysis is expected to use the TypeScript
  Compiler API (`Program`/`TypeChecker`) directly behind a thin
  Patchwork-owned abstraction, not `ts-morph` as a core domain dependency
  — **not yet an implemented architectural decision**.
- Confidence should primarily come from evidence the system collected, not
  an arbitrary model-generated confidence number.
- False positives and false negatives are primary quality metrics for this
  system, not just test pass/fail. The "unsafe-clear rate" (false
  `NOT_AFFECTED`) is the single most safety-sensitive metric.
- An `ImpactAssessment` is not timeless truth about a commit SHA — it's
  truth about a specific `(RepositorySnapshot, AnalysisRun)` pair, since
  re-analysis with a newer analyzer/ruleset can legitimately change the
  answer. See docs/data-model.md.
- Every rule/predicate must be validated against a control benchmark
  corpus (fixtures shaped around the specific behavior being tested), a
  realistic corpus (ordinary production TypeScript patterns not shaped
  around the analyser's own capabilities), and, where a genuine public
  example exists, a historical corpus (minimal reconstructions of real
  GitHub repositories at the commit before a real developer's Stripe
  migration) — a perfect control-corpus score alone is not sufficient
  evidence a predicate generalizes. See docs/impact-analysis.md's
  Evaluation approach, Realistic validation, and Historical validation
  sections.

## Security principles

- Customer repositories are sensitive, untrusted code.
- Future repository execution must occur in an isolated sandbox, never
  directly inside the API or worker process.
- Package installation (`npm install` / `pnpm install`) can execute
  arbitrary repository scripts — treat it as untrusted code execution, not
  a safe setup step.
- GitHub access must use least privilege; installation tokens should be
  short-lived and generated only when needed.
- Webhook signatures must be verified; webhook processing must be
  idempotent.
- Secrets must never be logged.
- Authorization must enforce repository/customer isolation.
- LLM output must never directly authorize a privileged action.
- Source-code persistence should be minimized.

Full threat model: [docs/security.md](docs/security.md).

## Architectural baseline

TypeScript monorepo, pnpm workspaces, Turborepo, PostgreSQL, Drizzle,
Vitest, GitHub Actions CI. Style: **modular monolith** — see
[ADR-001](docs/adr/0001-modular-monolith-processes.md).

| Component         | Role                     | Status                                 |
| ----------------- | ------------------------ | -------------------------------------- |
| `apps/web`        | Next.js frontend         | Placeholder page only                  |
| `apps/api`        | Fastify HTTP API         | `GET /health`, `GET /ready` only       |
| `apps/worker`     | Background process       | Starts, pings DB, shuts down — no jobs |
| `packages/config` | Env/configuration        | Implemented                            |
| `packages/db`     | PostgreSQL/Drizzle infra | Implemented, one placeholder table     |

Do not describe future modules (GitHub integration, impact analysis, patch
generation, verification, AI reasoning) as though they already exist in the
code. When documenting or discussing them, label status explicitly:

- **CURRENT** — implemented and verified in this repository today.
- **DECIDED BUT NOT IMPLEMENTED** — recorded in an ADR or this file, not yet
  built.
- **PROPOSED** — a reasonable direction, not yet agreed or committed.
- **OPEN QUESTION** — genuinely undecided.

Full architecture: [docs/architecture.md](docs/architecture.md). Candidate
(not implemented) domain concepts: [docs/data-model.md](docs/data-model.md).

## ADRs

`docs/adr/` records meaningful architectural decisions and why they were
made, including alternatives considered. Read the relevant ADR(s) before
changing architecture they cover.

- Do not silently contradict or reverse a decision recorded in an ADR.
- If a decision needs revisiting, propose a new ADR that supersedes the old
  one — explain what changed and why — rather than changing the system and
  leaving the ADR stale.
- Do not write speculative ADRs for decisions that haven't actually been
  made.
