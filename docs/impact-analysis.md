# Impact Analysis

This is the central engineering problem for Patchwork and the most important
technical document in this repository. One real rule is now implemented
end-to-end (see "First candidate rule" and "Next engineering sequence"
below); everything beyond it remains principles and a likely pipeline
shape, not a finalized design. It was revised following external
technical/product research; corrections that research introduced are
marked explicitly rather than blended in silently.

## Product positioning (PROPOSED — correction)

Patchwork is initially **an evidence-producing impact engine**, not
primarily an automatic API-fixing agent:

```
external change
  → version applicability
  → exact repository usages
  → evidence-backed AFFECTED / NOT_AFFECTED / UNCERTAIN
  → migration requirement
```

Deterministic fixes come later, only for the subset where the
transformation is genuinely mechanical, and remain subordinate to this
impact model. "AI-driven automated code migration" on its own is not a
defensible differentiator — general coding agents, dependency-update bots,
and semantic migration tools already do variations of it. The differentiated
capability under test is narrower:

> High-confidence mapping from an externally defined provider change to the
> exact client-code usages to which it applies, with enough evidence to
> justify both positive and negative conclusions.

This does not change [CLAUDE.md](../CLAUDE.md#product)'s stated end-to-end
vision (change → normalize → locate → assess → explain → patch → verify →
PR) — it changes the sequencing and the emphasis: impact intelligence and
evidence come first and matter most; patch generation, verification
automation, and PR creation come later and are secondary.

## The question

Does this specific `ProviderChange` actually affect this specific
repository, and exactly where? See [data-model.md](data-model.md) for the
structured breakdown of what a `ProviderChange` decomposes into
(`ApplicabilityConstraint`, `ImpactPredicate`, `MigrationRequirement`, and
the optional `TransformationRecipe`/`VerificationExpectation`), and for the
`RepositorySnapshot`/`AnalysisRun` reproducibility model an
`ImpactAssessment` is actually truth about.

## Principles (DECIDED BUT NOT IMPLEMENTED)

- **Evidence-driven, not a single model call.** An `ImpactAssessment` is
  built from a pipeline of deterministic steps plus targeted AI reasoning,
  not "ask an LLM if this repo is affected."
- **Deterministic analysis before AI, wherever possible.** AI is for
  resolving genuine semantic ambiguity that static analysis can't settle —
  not a replacement for things normal software can determine reliably. See
  "AI system principles" in [CLAUDE.md](../CLAUDE.md#ai-system-principles).
  Research into LLM-based migration/repair consistently shows strong
  performance on individual edits but much weaker performance on complete,
  correct migrations — "the model produced a plausible edit" is not
  evidence that "the migration is complete."
- **Don't send whole repositories to an LLM** when targeted context
  (the specific usages found by static analysis) is sufficient.
- **Regex is a candidate-discovery aid only, never final semantic proof.**
  It may cheaply narrow which files to look at, but locating and confirming
  actual TypeScript usage requires compiler-resolved semantic analysis, not
  pattern matching over source text.
- **Confidence comes from collected evidence**, not an arbitrary
  model-generated confidence number. An assessment's confidence should be
  traceable to what was actually found (e.g. "found 3 call sites matching
  the changed signature, in files X/Y/Z") not a bare score the model
  asserts.
- **False positives and false negatives are primary quality metrics** for
  this system, on the same footing as tests passing. A confident wrong
  answer (either direction) is a product failure, not just an accuracy
  statistic.

## Tri-state assessment is a safety rule, not just UX (CURRENT for the one encoded rule; correction)

`AFFECTED` / `NOT_AFFECTED` / `UNCERTAIN` is a safety property. The
governing invariant:

> **Failure to prove `AFFECTED` is NOT evidence of `NOT_AFFECTED`.**

`NOT_AFFECTED` requires **explicit negative evidence** (e.g. confirmed
incompatible version, an exhaustively analysed relevant usage surface, or a
rule-specific negative proof) — it is never the default when analysis
simply didn't find a match. Conditions that should generally produce
`UNCERTAIN` instead of a confident answer in either direction:

- unresolved imports
- unsupported source patterns
- unknown runtime/API version (including any `UNKNOWN` version-evidence
  field — see data-model.md)
- dynamic construction (computed property access, dynamic `require`, etc.)
- analysis failure (broken TS config, missing dependencies, monorepo
  resolution problems)
- incomplete analysis coverage

An analyser that reports high precision/recall while quietly excluding a
large fraction of repositories whose TypeScript programs didn't load is
misleading — coverage must be reported alongside accuracy, not hidden by
only measuring against the subset that succeeded.

**Implemented for the one encoded rule** in
`apps/api/src/analysis/impact/assess.ts`: applicability is evaluated
before the predicate ever runs — `NOT_APPLICABLE` (a proven version-based
negative) yields `NOT_AFFECTED` directly; `UNKNOWN` applicability yields
`UNCERTAIN` directly, **even when the predicate independently finds a
matching call** (insufficient applicability evidence caps the result, it
is never overridden by a match); only `APPLICABLE` unlocks a
predicate-driven `AFFECTED`/`NOT_AFFECTED`/`UNCERTAIN` verdict. Across
multiple workspaces in a monorepo, results aggregate with `AFFECTED` >
`UNCERTAIN` > `NOT_AFFECTED` precedence — a proven positive finding in one
workspace is never suppressed by uncertainty elsewhere, since the
invariant this guards is "failure to prove `AFFECTED` is not evidence of
`NOT_AFFECTED`," not "any uncertainty anywhere poisons a proven finding."

## Likely pipeline (steps through ImpactPredicate matching CURRENT for the one encoded rule; the rest PROPOSED)

```
ProviderChange
  → ApplicabilityConstraint match   <- CURRENT (apps/api/src/analysis/
                                       impact/applicability.ts, from
                                       already-collected AnalysisRun
                                       evidence, no new network calls --
                                       see data-model.md's version-
                                       applicability-as-evidence correction)
  → repository inventory            <- CURRENT (the exact-SHA archive,
                                       re-acquired per assessment)
  → candidate discovery             <- CURRENT (cheap lexical prefilter:
                                       does the file text contain the
                                       target property name at all --
                                       regex/lexical only, never decisive)
  → TypeScript semantic analysis    <- CURRENT (real Program/TypeChecker,
                                       see "Analyzer escalation ladder")
  → ImpactPredicate matching        <- CURRENT (does the confirmed
                                       property-access resolve to the
                                       change's affected symbol?)
  → relevant context extraction     PROPOSED, not implemented -- no AI step exists
  → AI reasoning only where needed  PROPOSED, not implemented -- no LLM
                                       is called anywhere in this pipeline
  → evidence aggregation            <- CURRENT (apps/api/src/analysis/
                                       impact/assess.ts)
  → AFFECTED / NOT_AFFECTED / UNCERTAIN  <- CURRENT
```

Every step through evidence aggregation is fully deterministic code for
this one rule — no AI reasoning step exists yet because none was needed:
the predicate is provable or it isn't, and "provable-but-ambiguous"
already has a safe answer (`UNCERTAIN`).

## Analyzer escalation ladder (Levels A–B, and a same-file slice of C, CURRENT for the one encoded rule)

Static analysis has a real cost/precision escalation curve — cheaper, more
precise local analysis first; expensive global analysis only when justified.

```
Level A: lexical candidate discovery        cheap, never decisive          <- CURRENT
Level B: compiler symbol/type confirmation  MVP core                       <- CURRENT
Level C: alias/re-export/wrapper resolution add early                      <- CURRENT, same-file only
Level D: local data flow                    rule-specific                  not needed by this rule
Level E: cross-function/interprocedural     only after evidence demands it not implemented
Level F: runtime-dependent                  UNCERTAIN, or future telemetry not implemented
```

**Level C is deliberately narrower than the general case**: only
same-file alias/wrapper resolution is supported (ordinary TypeScript type
inference within one bounded, in-memory `Program` per candidate file — see
`apps/api/src/analysis/impact/predicate.ts`). Cross-file re-exports and
wrapper functions imported from another module are `UNCERTAIN`, not
resolved — proven by test fixtures distinguishing the two cases. No
evidence yet justifies building genuine cross-file resolution (Level D/E),
matching the escalation principle below.

**Do not implement a general call graph or heavyweight whole-program
analysis before benchmark evidence (see "Evaluation approach" below) shows
a specific rule class actually needs it.** Research on stateful/multi-call
API migration (value-flow graphs, flow-sensitive pointer analysis,
state-machine inference) demonstrates both that much deeper analysis is
possible in constrained domains, and how much more complex the system
becomes once it's needed — that complexity should be earned by evidence,
not built preemptively.

## TypeScript analysis approach (CURRENT for the one encoded rule — correction, now validated)

- The semantic foundation is the **TypeScript Compiler API** directly
  (`Program`, `TypeChecker`) — symbols, declarations, and resolved types
  give a real "does this property/call actually belong to Stripe?" answer,
  rather than a textual approximation. Validated against the real
  compiler, not just designed: `checker.getSymbolAtLocation()` on a
  `PropertyAccessExpression`, checked against whether the resolved
  declaration's source file is a trusted stub (below), correctly
  distinguishes direct calls, same-file aliases, and bare method
  references (all confirmed matches) from unrelated same-named methods,
  comments/strings, and dynamic/unresolved constructions (correctly
  `UNCERTAIN`, never a false match) — see
  `apps/api/src/analysis/impact/predicate.ts` and its ~15-scenario test
  fixture matrix.
- **No package installation, ever** — repository analysis deliberately
  never runs `npm install`/`pnpm install` (untrusted code execution; see
  [docs/security.md](security.md)), so real `stripe-node` type
  declarations are never available from a real `node_modules`. Instead: a
  small, **Patchwork-owned, trusted ambient type stub**
  (`apps/api/src/analysis/impact/stripe-type-stub.ts`, a `declare module
'stripe' { ... }` committed to this repository, reviewed like any other
  rule code, verified against the real `stripe-node` source and its real
  export shape) declares just enough surface for the TypeChecker to
  resolve real provenance for the one symbol this rule cares about.
  Installing real type declarations was ruled out as crossing the
  untrusted-execution boundary; this stub is the deterministic, bounded
  alternative that was chosen instead.
- Behind a **thin, Patchwork-owned analysis abstraction** — not a
  dependency on `ts-morph` for the core domain. `ts-morph` may be used
  later purely as an implementation convenience for AST _transformation_
  (patch generation), where its ergonomics are a genuine benefit and the
  correctness burden is lower — it should not become something the impact
  engine's correctness depends on.
- Regex/lexical matching is for **candidate discovery only** (see the
  escalation ladder above) — never the final semantic proof for an
  `ImpactPredicate` match.
- **Bounded, in-memory `Program` per candidate file**, not a full
  per-tsconfig project graph: each candidate file gets its own `Program`
  (the trusted stub + that one file, via an in-memory `CompilerHost` — no
  real disk I/O, no `node_modules`), using the nearest enclosing
  `tsconfig.json`'s `compilerOptions` if one was extracted (a bounded
  fallback, not full `extends`/`references`/`include` resolution), with
  `noLib: true` since this analysis never needs global lib types. This
  keeps same-file resolution (the actual scope of Level C above) fully
  correct without needing whole-repository project construction.

## Evaluation approach (PROPOSED)

A benchmark is needed **before** a polished product — there is no credible
external precision/recall number to import, since published results (e.g.
from other language/library migration research) come from different tasks
and correctness definitions and don't transfer.

Planned fixture design, per real `ProviderChange`:

- **Positive fixtures** — direct usage, aliasing, destructuring, wrapper
  functions, re-exports, monorepo-package usage, multiple clients.
- **Negative fixtures** — unrelated objects with the same method/property
  name, user-defined Stripe-looking interfaces, usage of a version outside
  the affected range, a dependency that isn't actually `stripe`.
- **Ambiguous/adversarial fixtures** — `any`-typed values, computed
  property access, unresolved packages, dynamic `require`, an invalid
  TypeScript project, wrapper functions where provenance escapes analysis.
- **Real historical migration pairs** — a commit before a real Stripe
  upgrade and the commit after the corresponding developer migration, for
  realism synthetic fixtures can't fully provide.

Metrics to track (not just location precision/recall):

| Metric                      | Why it matters                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Repository/change recall    | Did we detect that an affected repository is affected?                                               |
| Location precision/recall   | Are shown locations relevant, and complete?                                                          |
| **Unsafe-clear rate**       | Among `NOT_AFFECTED` conclusions, how many were actually affected — the most safety-sensitive number |
| Abstention rate             | How often the result was `UNCERTAIN`                                                                 |
| Useful coverage             | Fraction safely resolved to `AFFECTED`/`NOT_AFFECTED` rather than abstaining                         |
| Version-resolution coverage | Fraction whose effective applicability could be established at all                                   |
| Analysis failure rate       | Broken configs, missing deps, unsupported syntax                                                     |
| Evidence correctness        | Does each reported explanation match the rule actually matched?                                      |

**Gate before shipping any supported rule: zero known false `NOT_AFFECTED`
classifications on the curated benchmark.** That is a minimum engineering
gate, not a claim that production false negatives will be zero.

## First candidate rule (CURRENT — implemented)

Rather than starting with a trivial field rename purely because it's easy,
the first manually-encoded `ProviderChange` is one with a richer test
surface: **Stripe's Basil-release replacement of the Upcoming Invoice
API** (`stripe.invoices.retrieveUpcoming` → `stripe.invoices.createPreview`).
It naturally exercises direct calls, aliasing, method references, and
negative near-matches (an unrelated object that happens to share the
method name) — a stronger first test of the escalation ladder than a
single-property rename would be.

**Official provenance** (verified directly, not paraphrased from
third-party summaries):

- Changelog (source of truth):
  [`docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations`](https://docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations)
  — `GET /v1/invoices/upcoming` and `/upcoming/lines` are removed at API
  version `2025-03-31.basil`, replaced by `POST /v1/invoices/create_preview`.
- SDK boundary, verified directly against `stripe-node` source (not the
  wiki): `stripe.invoices.retrieveUpcoming` exists in
  `src/resources/Invoices.ts` at tag `v17.7.0` (pre-Basil); absent from
  current `master`, replaced by `createPreview`. Node SDK `v18.0.0` is the
  corresponding upgrade (per the changelog's own upgrade instructions).

**Encoded as** `apps/api/src/analysis/impact/stripe-basil-invoice-preview.ts`
(`externalId: 'basil-2025-03-31-invoice-preview-api-deprecations'`,
`ruleVersion: 'v1'`, `predicateKind: 'stripe_invoices_retrieve_upcoming'`),
persisted via idempotent upsert into `provider_changes`/`rule_versions`
(see [data-model.md](data-model.md)) — not an admin-authored row, not an
ingestion pipeline. `migrationRequirement` is Stripe's own verbatim
migration text.

**Scope note**: only `stripe.invoices.retrieveUpcoming` is evaluated by
the predicate — the sibling removed method `listUpcomingLines` is noted in
the source record but not checked by this rule.

## Next engineering sequence (all four steps below now CURRENT for one rule)

```
RepositorySnapshot (exact SHA)          <- CURRENT
  → AnalysisRun                          <- CURRENT
  → Stripe/TypeScript version-applicability evidence   <- CURRENT
  → one manually encoded real Stripe ProviderChange     <- CURRENT
  → TypeScript semantic impact engine (compiler-resolved direct usage
     + basic same-file alias resolution)                <- CURRENT
  → tri-state evaluation harness/benchmark corpus       PROPOSED
```

The first implements the reproducibility boundary — resolving and
recording an exact commit SHA (`RepositorySnapshot`) plus one execution
record referencing it (`AnalysisRun`). The second acquires the exact-SHA
archive and collects deterministic evidence from it: which
workspaces/packages declare a `stripe` dependency and what version they
resolve to (`InstalledSdkEvidence`), and any statically-resolvable
`apiVersion` passed to `new Stripe(...)` (`ClientVersionEvidence`) — never
a decision about whether any Stripe API change affects the repository,
and never a single repository-level version field (see
[docs/data-model.md](data-model.md#version-applicability-is-evidence-not-one-repository-field-current-for-installedsdkevidenceclientversionevidence-correction-from-the-original-candidate-model)).

**The third and fourth steps are what this slice adds**: one real,
manually-verified `ProviderChange` (see "First candidate rule" above) is
evaluated against an existing `AnalysisRun`'s evidence and a freshly
re-acquired archive, producing an evidence-backed `AFFECTED` /
`NOT_AFFECTED` / `UNCERTAIN` `ImpactAssessment` with `Finding` rows (see
[docs/data-model.md](data-model.md)) — real TypeScript Compiler API
semantic proof, not a text match. `POST /analysis-runs/:id/impact-
assessments` triggers it (see
[docs/architecture.md](architecture.md)). Verified against the real
`HamidZ11/trading-journal` repository (no Stripe dependency — correctly
`NOT_AFFECTED`) and a purpose-built controlled fixture repository
exercising a real positive match (see the real-repository verification
section of this slice's implementation).

**The fifth step remains PROPOSED, not implemented**: no formal labelled
benchmark corpus (real historical migration pairs, the full metrics table
under "Evaluation approach" above) exists yet — this slice's ~15-scenario
synthetic fixture matrix plus one manual real-GitHub verification is not
that benchmark, just enough to prove the mechanism works correctly.
Everything beyond this rule (patch generation, a second rule, automated
changelog ingestion) remains unimplemented, and none of it should be
started without a separate planning/approval pass.

## Open questions

- Exact scoring/aggregation method when multiple pieces of evidence
  disagree — partially answered for this one rule (`AFFECTED` >
  `UNCERTAIN` > `NOT_AFFECTED` precedence across workspaces, see the
  tri-state section above), not yet validated against a second rule with
  different aggregation needs.
- Where the line sits between "deterministic rule matching resolves this"
  and "this needs AI reasoning" for a given rule — this first rule needed
  no AI reasoning step at all; still undecided whether/when a future rule
  will.
- How `UNCERTAIN` results are surfaced to the user (vs. suppressed, vs.
  escalated for review) — currently just shown as-is with its reason
  (see the repositories page UI), no triage/escalation workflow exists.
- Whether/when the analyzer escalation ladder needs Level D (local data
  flow) or beyond — not needed by this rule; still not yet known for
  future rules, since no benchmark exists yet to demonstrate the need.
- Per-call-site linking between a specific `new Stripe()` construction and
  a specific predicate match's effective `apiVersion` — this rule
  evaluates applicability at the workspace level from all evidence in
  that workspace, not proven per call site; multiple Stripe clients with
  different `apiVersion`s in one workspace conservatively yield `UNKNOWN`
  applicability rather than a precise per-call answer.

## Deferred

A second rule, automated Stripe changelog ingestion, `TransformationRecipe`/
`VerificationExpectation`, a formal labelled benchmark corpus (the
"Evaluation approach" metrics table above), and all patching/verification/
PR automation downstream of impact analysis. This document will be revised
again as a second real rule validates or invalidates the pipeline shape
above — treat it as a working hypothesis proven for exactly one rule, not
a finished spec.
