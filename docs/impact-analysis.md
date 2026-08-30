# Impact Analysis

This is the central engineering problem for Patchwork and the most important
technical document in this repository. Not yet implemented — this records
principles and a likely pipeline shape, not a finalized design. It was
revised following external technical/product research; corrections that
research introduced are marked explicitly rather than blended in silently.

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

## Tri-state assessment is a safety rule, not just UX (PROPOSED — correction)

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

## Likely pipeline (PROPOSED)

```
ProviderChange
  → ApplicabilityConstraint match   (does this change apply to this
                                       SDK/API/account/product version
                                       at all — see data-model.md's
                                       version-applicability-as-evidence
                                       correction)
  → repository inventory            (what does this repository look like?)
  → candidate discovery             (where might the changed surface
                                       be used? — regex/lexical only,
                                       never decisive)
  → TypeScript semantic analysis    (compiler-resolved confirmation,
                                       see "Analyzer escalation ladder")
  → ImpactPredicate matching        (does confirmed usage match the
                                       change's predicates?)
  → relevant context extraction     (pull just the code needed)
  → AI reasoning only where needed  (resolve remaining ambiguity)
  → evidence aggregation
  → AFFECTED / NOT_AFFECTED / UNCERTAIN
```

## Analyzer escalation ladder (PROPOSED)

Static analysis has a real cost/precision escalation curve — cheaper, more
precise local analysis first; expensive global analysis only when justified.

```
Level A: lexical candidate discovery        cheap, never decisive
Level B: compiler symbol/type confirmation  MVP core
Level C: alias/re-export/wrapper resolution add early
Level D: local data flow                    rule-specific
Level E: cross-function/interprocedural     only after evidence demands it
Level F: runtime-dependent                  UNCERTAIN, or future telemetry
```

**Do not implement a general call graph or heavyweight whole-program
analysis before benchmark evidence (see "Evaluation approach" below) shows
a specific rule class actually needs it.** Research on stateful/multi-call
API migration (value-flow graphs, flow-sensitive pointer analysis,
state-machine inference) demonstrates both that much deeper analysis is
possible in constrained domains, and how much more complex the system
becomes once it's needed — that complexity should be earned by evidence,
not built preemptively.

## TypeScript analysis approach (PROPOSED — correction)

- The semantic foundation is the **TypeScript Compiler API** directly
  (`Program`, `TypeChecker`) — symbols, declarations, and resolved types
  give a real "does this property/call actually belong to Stripe?" answer,
  rather than a textual approximation.
- Behind a **thin, Patchwork-owned analysis abstraction** — not a
  dependency on `ts-morph` for the core domain. `ts-morph` may be used
  later purely as an implementation convenience for AST _transformation_
  (patch generation), where its ergonomics are a genuine benefit and the
  correctness burden is lower — it should not become something the impact
  engine's correctness depends on.
- Regex/lexical matching is for **candidate discovery only** (see the
  escalation ladder above) — never the final semantic proof for an
  `ImpactPredicate` match.

This corrects the previous framing here, which listed `ts-morph` as a
possible core dependency without this distinction. It remains **not yet an
implemented architectural decision** — to be validated against the first
real vertical slice.

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

## First candidate rule (PROPOSED)

Rather than starting with a trivial field rename purely because it's easy,
the first manually-encoded `ProviderChange` should be one with a richer
test surface — e.g. Stripe's Basil-release replacement of the Upcoming
Invoice API (`stripe.invoices.retrieveUpcoming` → Create Preview Invoice).
It naturally exercises direct calls, aliasing, parameter propagation,
method references, and negative near-matches (an unrelated object that
happens to share the method name) — a stronger first test of the escalation
ladder than a single-property rename would be.

## Next engineering sequence (PROPOSED)

The highest-leverage next slice is not automated Stripe changelog ingestion
and not AI:

```
RepositorySnapshot (exact SHA)
  → AnalysisRun
  → Stripe/TypeScript version-applicability evidence
  → one manually encoded real Stripe ProviderChange
  → TypeScript semantic impact engine (compiler-resolved direct usage
     + basic alias/re-export resolution)
  → tri-state evaluation harness/benchmark corpus
```

Nothing in this sequence is implemented yet, and none of it should be
started without a separate planning/approval pass — this document exists so
that pass starts from a corrected model, not to authorize starting it.

## Open questions

- Exact scoring/aggregation method when multiple pieces of evidence
  disagree.
- Where the line sits between "deterministic rule matching resolves this"
  and "this needs AI reasoning" for a given rule.
- How `UNCERTAIN` results are surfaced to the user (vs. suppressed, vs.
  escalated for review).
- Whether/when the analyzer escalation ladder needs Level D (local data
  flow) or beyond for the first real rule — not yet known, since no
  benchmark exists yet to demonstrate the need.

## Deferred

The entire implementation, and all patching/verification/PR automation
downstream of it. This document will be revised again as the first real
vertical slice validates or invalidates the pipeline shape above — treat
it as a working hypothesis, not a spec.
