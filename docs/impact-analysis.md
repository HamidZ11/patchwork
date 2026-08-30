# Impact Analysis

This is the central engineering problem for Patchwork and the most important
technical document in this repository. Not yet implemented — this records
principles and a likely pipeline shape, not a finalized design.

## The question

Does this specific `ProviderChange` actually affect this specific
repository, and exactly where? See [data-model.md](data-model.md) for the
conceptual separation between `ProviderChange`, `ChangeRule`,
`RepositorySnapshot`, and `ImpactAssessment`.

## Principles (DECIDED BUT NOT IMPLEMENTED)

- **Evidence-driven, not a single model call.** An `ImpactAssessment` is
  built from a pipeline of deterministic steps plus targeted AI reasoning,
  not "ask an LLM if this repo is affected."
- **Deterministic analysis before AI, wherever possible.** AI is for
  resolving genuine semantic ambiguity that static analysis can't settle —
  not a replacement for things normal software can determine reliably. See
  "AI system principles" in [CLAUDE.md](../CLAUDE.md#ai-system-principles).
- **Don't send whole repositories to an LLM** when targeted context
  (the specific usages found by static analysis) is sufficient.
- **Regex is not the primary mechanism for semantic code understanding.**
  It may be useful for narrow, well-understood text matching, but locating
  and reasoning about TypeScript usage requires semantic analysis, not
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

## Likely pipeline (PROPOSED)

```
ProviderChange
  → ChangeRule
  → dependency/version filtering        (does this repo even use the
                                          affected dependency/version?)
  → repository inventory                (what does this repo look like?)
  → candidate discovery                 (where might the changed surface
                                          be used?)
  → TypeScript semantic/static analysis (confirm actual usage, not just
                                          text matches)
  → deterministic rule matching         (does usage match the ChangeRule?)
  → relevant context extraction         (pull just the code needed)
  → AI reasoning only where needed      (resolve remaining ambiguity)
  → evidence aggregation
  → AFFECTED / NOT_AFFECTED / UNCERTAIN
```

`UNCERTAIN` is a legitimate, expected output — the system should be able to
say "not sure" with its evidence shown, rather than being forced into a
confident but potentially wrong binary answer.

## TypeScript analysis approach

Expected to use the TypeScript compiler ecosystem for semantic/static
analysis (possibly `ts-morph`), since accurately locating and reasoning
about affected usages needs real type/AST information, not text search.
**This is not yet an implemented architectural decision** — it will be
validated against the first real vertical slice before being treated as
settled.

## Evaluation approach (PROPOSED)

Planned: a set of fixture repositories with labelled, known-correct
expected outcomes (affected / not affected / uncertain, and where) for a
small set of real Stripe breaking changes. This labelled evaluation set is
how false-positive/false-negative rates get measured, not just unit tests
of individual pipeline steps. Not yet built.

## Open questions

- Exact scoring/aggregation method when multiple pieces of evidence
  disagree.
- Where the line sits between "deterministic rule matching resolves this"
  and "this needs AI reasoning" for a given `ChangeRule`.
- How `UNCERTAIN` results are surfaced to the user (vs. suppressed, vs.
  escalated for review).

## Deferred

The entire implementation. This document will be revised as the first real
vertical slice validates or invalidates the pipeline shape above — treat
the pipeline as a working hypothesis, not a spec.
