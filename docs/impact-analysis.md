# Impact Analysis

This is the central engineering problem for Patchwork and the most important
technical document in this repository. Four real rules are now implemented
end-to-end against a shared engine, and a controlled benchmark corpus
measures whether that generalizes (see "Rules implemented", "Analyzer
escalation ladder", and "Evaluation approach" below); everything beyond
that remains principles and a likely pipeline shape, not a finalized
design. It was revised following external technical/product research;
corrections that research introduced are marked explicitly rather than
blended in silently.

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

## Tri-state assessment is a safety rule, not just UX (CURRENT across all four encoded rules; correction)

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

**Implemented once, shared by every rule**, in
`apps/api/src/analysis/impact/assess.ts`'s `assessRuleImpact(evidence,
files, coverage, rule)`: applicability is evaluated before the predicate
ever runs — `NOT_APPLICABLE` (a proven version-based negative) yields
`NOT_AFFECTED` directly; `UNKNOWN` applicability yields `UNCERTAIN`
directly, **even when the predicate independently finds a matching call**
(insufficient applicability evidence caps the result, it is never
overridden by a match); only `APPLICABLE` unlocks a predicate-driven
`AFFECTED`/`NOT_AFFECTED`/`UNCERTAIN` verdict. Across multiple workspaces
in a monorepo, results aggregate with `AFFECTED` > `UNCERTAIN` >
`NOT_AFFECTED` precedence — a proven positive finding in one workspace is
never suppressed by uncertainty elsewhere, since the invariant this
guards is "failure to prove `AFFECTED` is not evidence of `NOT_AFFECTED`,"
not "any uncertainty anywhere poisons a proven finding." This aggregation
logic is rule-agnostic — only `rule.applicabilityConfig` and
`rule.runPredicate` differ per rule (see "Rule/predicate reuse" below).

## Likely pipeline (steps through ImpactPredicate matching CURRENT across all four encoded rules; the rest PROPOSED)

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
all four rules — no AI reasoning step exists yet because none was needed:
each predicate is provable or it isn't, and "provable-but-ambiguous"
already has a safe answer (`UNCERTAIN`).

## Analyzer escalation ladder (Levels A–B, and a same-file slice of C, CURRENT across all four encoded rules)

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
inference within one bounded, in-memory `Program` per candidate file —
the shared scanning infrastructure lives in `apps/api/src/analysis/
impact/predicates/engine.ts`, parameterized by a cheap lexical
`prefilter` and a rule-specific `PredicateVisitor`). Cross-file
re-exports and wrapper functions imported from another module are
`UNCERTAIN`, not resolved — proven by test fixtures distinguishing the
two cases for every rule. No evidence yet justifies building genuine
cross-file resolution (Level D/E), matching the escalation principle
below.

**Do not implement a general call graph or heavyweight whole-program
analysis before benchmark evidence (see "Evaluation approach" below) shows
a specific rule class actually needs it.** Research on stateful/multi-call
API migration (value-flow graphs, flow-sensitive pointer analysis,
state-machine inference) demonstrates both that much deeper analysis is
possible in constrained domains, and how much more complex the system
becomes once it's needed — that complexity should be earned by evidence,
not built preemptively.

## TypeScript analysis approach (CURRENT across all four encoded rules — correction, now validated)

- The semantic foundation is the **TypeScript Compiler API** directly
  (`Program`, `TypeChecker`) — symbols, declarations, and resolved types
  give a real "does this property/call actually belong to Stripe?" answer,
  rather than a textual approximation. Validated against the real
  compiler, not just designed: `checker.getSymbolAtLocation()`, checked
  against whether the resolved declaration's source file is a trusted
  stub (below), correctly distinguishes direct calls, same-file aliases,
  and bare method references (all confirmed matches) from unrelated
  same-named methods, comments/strings, and dynamic/unresolved
  constructions (correctly `UNCERTAIN`, never a false match) — see
  `apps/api/src/analysis/impact/predicates/` and its per-primitive test
  fixture matrices (16 scenarios for member-access, 14 each for
  call-argument-property and literal-comparison).
- **Three reusable predicate primitives**, all sharing the same
  confirmed-match / confirmed-non-match / ambiguous three-way contract,
  built on the shared engine above:
  - `member-access.ts` — does a `PropertyAccessExpression` named X
    resolve to a declaration in the stub? Used by two rules
    (`retrieveUpcoming` method removal, `Invoice.subscription` property
    removal) — the first concrete proof this primitive reuses across
    rules, not just supports a second one in name.
  - `call-argument-property.ts` — does a `CallExpression` whose callee
    resolves to a stub method contain an object-literal property named X
    anywhere in its arguments? Used by the `SubscriptionSchedules`
    `iterations` parameter removal (a request-argument shape, distinct
    from a response-property read).
  - `literal-comparison.ts` — does a `BinaryExpression` compare a
    stub-typed property against a specific string literal? Used by the
    Issuing `Authorization.status` enum split (a literal-domain shape,
    distinct from either of the above — no property/method is removed,
    just a comparison that's now semantically incomplete).
    No generic rule DSL was introduced for these three primitives — see
    "Rule/predicate reuse" below for why.
- **No package installation, ever** — repository analysis deliberately
  never runs `npm install`/`pnpm install` (untrusted code execution; see
  [docs/security.md](security.md)), so real `stripe-node` type
  declarations are never available from a real `node_modules`. Instead: a
  small, **Patchwork-owned, trusted ambient type stub**
  (`apps/api/src/analysis/impact/stripe-type-stub.ts`, a `declare module
'stripe' { ... }` committed to this repository, reviewed like any other
  rule code, verified against the real `stripe-node` source and its real
  export shape) declares just enough surface for the TypeChecker to
  resolve real provenance for each rule's affected symbol. Installing
  real type declarations was ruled out as crossing the untrusted-execution
  boundary; this stub is the deterministic, bounded alternative that was
  chosen instead.
- **A minimal ambient `Promise<T>` is also declared alongside the stub**
  (not the real `lib.es2015.promise.d.ts` — just enough of a `then`
  member for the checker's await-unwrapping to work). This was a real
  analyser gap the benchmark corpus caught: with `noLib: true`, `Promise`
  is otherwise completely undeclared, so any realistic
  `const x = await stripe.y.retrieve(...)` (which is how virtually all
  real `stripe-node` calls are written) could never be proven to
  originate from the stub — every such call silently fell to `UNCERTAIN`
  instead of a confirmed match. Hand-written predicate tests for the
  `Invoice.subscription` and `Authorization.status` rules (both of whose
  stub methods return `Promise<T>`) failed until this was added; see
  "Analyser changes driven by benchmark evidence" below.
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

## Evaluation approach (CURRENT — controlled benchmark; real historical pairs still PROPOSED)

A benchmark is needed **before** a polished product — there is no credible
external precision/recall number to import, since published results (e.g.
from other language/library migration research) come from different tasks
and correctness definitions and don't transfer.

**Implemented** as `apps/api/src/benchmark/` — a hand-written,
hand-labelled fixture corpus (never generated by running the analyser
being evaluated) run through the **real** production pipeline
(`buildStripeEvidenceFromFiles` → `assessRuleImpact` against the real
`IMPACT_RULES` registry), not a parallel/shortcut implementation. Archive
extraction itself (tar packing/unpacking) is deliberately skipped — that
safety property is already covered by `archive.test.ts`; the benchmark
measures evidence → applicability → predicate → assess accuracy.

Fixture matrix, per rule (`apps/api/src/benchmark/cases/*.ts`, ~11 cases
× 4 rules = 44 total):

- **Positive** — direct usage, a same-file local alias, multiple usages in
  one file, a nested-workspace (monorepo) usage.
- **Negative** — the same method/property/literal on an unrelated object,
  the identifier only in a comment/string, Stripe present but the feature
  genuinely unused, an explicit pre-boundary `apiVersion` pin (structurally
  identical code, provably not applicable).
- **Uncertain** — dynamic/computed Stripe client construction, an
  unresolved cross-file import, no resolvable SDK version at all
  (`DECLARED_ONLY`, no lockfile).

Each `BenchmarkCase` is `{ id, ruleExternalId, category, files, expected:
{ status, findingCount?, findingLocations? }, notes }` — ground truth is
reviewed like any other code, never derived from the analyser under test.

**Classification** (comparing expected vs. actual status), implemented in
`apps/api/src/benchmark/run.ts`:

| expected → actual                    | bucket                                          |
| ------------------------------------ | ----------------------------------------------- |
| AFFECTED → AFFECTED                  | true positive                                   |
| NOT_AFFECTED → NOT_AFFECTED          | true negative                                   |
| UNCERTAIN → UNCERTAIN                | correct abstention                              |
| AFFECTED → NOT_AFFECTED              | **`falseNotAffectedSafetyFailures`** (critical) |
| AFFECTED → UNCERTAIN                 | over-abstention (capability gap, not unsafe)    |
| NOT_AFFECTED → AFFECTED              | false positive                                  |
| NOT_AFFECTED → UNCERTAIN             | over-abstention                                 |
| UNCERTAIN → AFFECTED or NOT_AFFECTED | unsafe certainty                                |

`precision(AFFECTED) = TP / (TP + falsePositives)`,
`recall(AFFECTED) = TP / (TP + falseNotAffectedSafetyFailures +
overAbstentionFromAffected)` — the false-`NOT_AFFECTED` count is never
folded into one opaque "accuracy" number, and never merged with
over-abstention. A **false `NOT_AFFECTED`** (expected `AFFECTED`, actual
`NOT_AFFECTED`) is a critical safety failure — the system claimed a
repository was safe when it wasn't. A **false `UNCERTAIN`** on an
expected-`AFFECTED` case is not equivalent — it's a capability limitation,
strictly safer, tracked separately as over-abstention. **Unsafe certainty**
(expected `UNCERTAIN`, actual `AFFECTED`/`NOT_AFFECTED`) means the system
claimed a decision it had no basis for.

`apps/api/src/benchmark/__tests__/safety-gate.test.ts` runs the full
corpus inside `pnpm test` (CI-enforced, not just a manual check) and
asserts `falseNotAffectedSafetyFailures === 0` and
`unsafeCertaintyCount === 0` — the concrete implementation of the gate
below.

**Gate before shipping any supported rule: zero known false `NOT_AFFECTED`
classifications on the curated benchmark.** That is a minimum engineering
gate, not a claim that production false negatives will be zero.

Run it: `pnpm benchmark` (human-readable) or `pnpm --filter @patchwork/api
benchmark -- --json` (machine-readable). At the time of writing, all four
rules score AFFECTED precision 1.00 / recall 1.00, 0 false `NOT_AFFECTED`
safety failures, 0 unsafe certainty, and 0 over-abstentions across 44
cases — see "Analyser changes driven by benchmark evidence" below for why
that wasn't true on the first run.

**Deferred, not attempted this slice**: real historical migration pairs (a
commit before a real Stripe upgrade and the commit after the corresponding
developer migration) — the controlled, hand-labelled corpus above is
prioritized as a trustworthy foundation first; historical-repository
evaluation remains a future extension, not mined here.

### Rule/predicate reuse

Four rules now share one engine (`predicates/engine.ts`) and three small
primitives (`member-access.ts`, `call-argument-property.ts`,
`literal-comparison.ts` — see "TypeScript analysis approach" above), plus
one shared `computeApplicability(evidence, config)` and one shared
`assessRuleImpact(evidence, files, coverage, rule)`. No generic,
provider-independent rule DSL was introduced to get there — three small
concepts (call-target predicate, member-access predicate,
call-argument-property predicate, literal-domain predicate) covered four
materially different rule shapes without one. Stripe-specific semantic
logic (the stub, each rule's `applicabilityConfig`) stays Stripe-specific,
in `rules/*.ts` — only the mechanism generalized, not the domain
knowledge. Revisit a generic DSL only if a future rule needs a fourth
predicate shape that these three genuinely can't express, and explain the
concrete pressure before building it.

### Analyser changes driven by benchmark evidence

Both real analyser fixes below were found by the benchmark corpus and
hand-written predicate tests catching wrong results, not designed in
advance — the intended workflow (benchmark first → identify concrete
failure → make the smallest analyser improvement → rerun) working as
intended:

- **Missing ambient `Promise<T>`** (see "TypeScript analysis approach"
  above): with `noLib: true`, any call through `await stripe.x.retrieve(
...)` — the normal way real `stripe-node` code is written — could never
  resolve its awaited member's provenance, silently capping the
  `Invoice.subscription` and `Authorization.status` rules' realistic
  positive cases at `UNCERTAIN`. Fixed with a minimal structural `Promise<
T>` stand-in, not the real TS lib.
- **Workspace-attribution bug in `apiVersion` evidence**: `apps/api/src/
analysis/evidence/api-version.ts`'s `scanForClientVersionEvidence`
  attributed each `apiVersion` finding to the _source file's own
  containing directory_ (`workspacePathOf(file.path)`, meant only for
  manifest paths) rather than the nearest ancestor workspace root — so
  for any file not literally at a workspace's top level (i.e. almost all
  real code, e.g. `src/billing.ts` under workspace root `''`), the
  evidence's `workspacePath` never matched `computeApplicability`'s
  per-workspace lookup, and a provably pre-boundary `apiVersion` pin
  silently fell through to `UNKNOWN` applicability (`UNCERTAIN`) instead
  of the correct `NOT_APPLICABLE` (`NOT_AFFECTED`). This was a real,
  pre-existing production bug (present since the version-applicability
  evidence collector was first built), not something introduced by this
  slice — the benchmark's `*-negative-pre-boundary-api-version` case for
  every rule caught it as an over-abstention. Fixed by extracting the
  same ancestor-directory lookup the predicate engine already used
  correctly (`nearestWorkspaceFor`, now shared from `evidence/
manifests.ts`) and using it in `api-version.ts` too, instead of two
  diverging implementations of "which workspace does this file belong
  to." A pre-existing test (`api-version.test.ts`) had encoded the buggy
  value as its expected result; it was corrected alongside the fix, and a
  dedicated nested-workspace regression test was added.

## Rules implemented (CURRENT)

Four real, officially-verified Stripe changes, chosen for materially
different predicate shapes (method-call removal / response-property
relocation / request-argument-property removal / literal-domain split)
and two different applicability boundaries — not four variations on the
same shape. Each is encoded in its own file under `apps/api/src/analysis/
impact/rules/`, registered in `registry.ts`'s `IMPACT_RULES`, and
persisted via idempotent upsert into `provider_changes`/`rule_versions`
(see [data-model.md](data-model.md)) — not admin-authored rows, not an
ingestion pipeline. Every `migrationRequirement` is Stripe's own verbatim
migration text; every changelog/source citation below was verified
directly (changelog pages fetched, `stripe-node` type declarations diffed
at specific tags via `gh api`), not paraphrased from third-party
summaries.

### A — `retrieveUpcoming` method removal (first rule, unchanged from the prior slice)

**Stripe's Basil-release replacement of the Upcoming Invoice API**
(`stripe.invoices.retrieveUpcoming` → `stripe.invoices.createPreview`).

- Changelog: [`docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations`](https://docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations)
  — `GET /v1/invoices/upcoming` and `/upcoming/lines` are removed at API
  version `2025-03-31.basil`, replaced by `POST /v1/invoices/create_preview`.
- SDK boundary, verified against `stripe-node` source:
  `stripe.invoices.retrieveUpcoming` present at tag `v17.7.0`, absent at
  `v18.0.0`, replaced by `createPreview`.
- `apps/api/src/analysis/impact/rules/stripe-basil-retrieve-upcoming.ts`
  (`externalId: 'basil-2025-03-31-invoice-preview-api-deprecations'`,
  `predicateKind: 'stripe_invoices_retrieve_upcoming'`),
  `applicabilityConfig: { sdkBoundaryMajor: 18, apiVersionBoundaryDate:
'2025-03-31' }`, predicate: `scanForMemberAccess`.
- **Scope note**: only `retrieveUpcoming` is evaluated — the sibling
  removed method `listUpcomingLines` is noted but not checked by this rule.

### B — `Invoice.subscription` response-property relocation

**Response property removed**, replaced by
`invoice.parent.subscription_details.subscription`.

- Changelog: [`docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects`](https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects)
  — _"we deprecated the `quote`, `subscription`, `subscription_details`,
  and `subscription_proration_date` fields... Use
  `invoice.parent.subscription_details.subscription`... instead of
  `invoice.subscription`."_
- SDK boundary, verified against `stripe-node` source:
  `Invoice.subscription` present at tag `v17.7.0`, absent at `v18.0.0`.
  **Same boundary as rule A** — deliberately reused to prove
  `ApplicabilityConfig` generalizes across rules, not just supports a
  second one in name.
- `apps/api/src/analysis/impact/rules/stripe-basil-invoice-subscription.ts`
  (`externalId: 'basil-2025-03-31-adds-new-parent-field-to-invoicing-objects'`,
  `predicateKind: 'stripe_invoice_subscription_property'`), same
  `applicabilityConfig` as rule A, predicate: `scanForMemberAccess` (the
  same primitive as rule A, proving reuse, not just a second predicate
  that happens to share a name).

### C — `iterations` request-parameter removal

**Request parameter removed** from `SubscriptionSchedules.create`/
`.update` phases, replaced by `duration`.

- Changelog: [`docs.stripe.com/changelog/clover/2025-09-30/remove-iterations`](https://docs.stripe.com/changelog/clover/2025-09-30/remove-iterations)
  — _"We've removed the `iterations` parameter because `duration`
  replaces its functionality... Using `iterations`... now returns an
  error."_
- SDK boundary, verified against `stripe-node` source:
  `iterations?: number` present in `Phase` params through `v18.5.0`,
  absent at `v19.0.0`/`v19.1.0`. **A different boundary** (`2025-09-30` /
  SDK `v19`) than rules A/B/D — proving `ApplicabilityConfig` genuinely
  parameterizes a second date/version, not just reproduces the first one.
- `apps/api/src/analysis/impact/rules/stripe-clover-schedule-iterations.ts`
  (`externalId: 'clover-2025-09-30-remove-iterations'`, `predicateKind:
'stripe_subscription_schedule_iterations_param'`),
  `applicabilityConfig: { sdkBoundaryMajor: 19, apiVersionBoundaryDate:
'2025-09-30' }`, predicate: `scanForCallArgumentProperty` — deliberately
  shallow (proves the call target resolves to the stub; doesn't validate
  the full nested `phases[]` array shape, which would be unjustified
  complexity for one rule).

### D — Issuing `Authorization.status` literal-domain split

**New enum value introduced**: `'expired'`, previously conflated with
`'reversed'`.

- Changelog: [`docs.stripe.com/changelog/basil/2025-03-31/issuing-authorizations-expired`](https://docs.stripe.com/changelog/basil/2025-03-31/issuing-authorizations-expired)
  — _"Issuing authorizations expired by Stripe now transition to the
  `expired` status instead of the `reversed` status... introduces a new
  enum value, `expired`."_
- SDK boundary, verified against `stripe-node` source: `Status` union is
  `'closed' | 'pending' | 'reversed'` at tag `v17.7.0`, becomes `'closed' |
'expired' | 'pending' | 'reversed'` at `v18.0.0`. Same boundary as A/B.
- `apps/api/src/analysis/impact/rules/stripe-basil-issuing-authorization-status.ts`
  (`externalId: 'basil-2025-03-31-issuing-authorizations-expired'`,
  `predicateKind: 'stripe_issuing_authorization_status_reversed'`), same
  `applicabilityConfig` as rules A/B, predicate: `scanForLiteralComparison`
  — detects legacy code comparing `authorization.status === 'reversed'`,
  a pattern that now silently misses the split-out `'expired'` case.

**Considered and deliberately excluded**: `Subscription.current_period_
start`/`current_period_end` (moved to `SubscriptionItem`) — verified real
and correct, but the same response-property shape and boundary as rule B;
it wouldn't add distinguishing signal to this slice's diversity goal.

## Next engineering sequence (all five steps below now CURRENT)

```
RepositorySnapshot (exact SHA)          <- CURRENT
  → AnalysisRun                          <- CURRENT
  → Stripe/TypeScript version-applicability evidence   <- CURRENT
  → four manually encoded real Stripe ProviderChanges   <- CURRENT
  → TypeScript semantic impact engine (compiler-resolved direct usage
     + basic same-file alias resolution, three predicate primitives)
                                                          <- CURRENT
  → tri-state evaluation harness/benchmark corpus       <- CURRENT
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

The third and fourth steps: four real, manually-verified `ProviderChange`s
(see "Rules implemented" above) are evaluated against an existing
`AnalysisRun`'s evidence and a freshly re-acquired archive, producing an
evidence-backed `AFFECTED` / `NOT_AFFECTED` / `UNCERTAIN`
`ImpactAssessment` per rule with `Finding` rows (see
[docs/data-model.md](data-model.md)) — real TypeScript Compiler API
semantic proof, not a text match. `POST /analysis-runs/:id/impact-
assessments` evaluates every registered rule in one call (see
[docs/architecture.md](architecture.md)). Rule A was additionally
verified against the real `HamidZ11/trading-journal` repository (no
Stripe dependency — correctly `NOT_AFFECTED`) and a purpose-built
controlled fixture repository (`HamidZ11/stripe-basil-fixture`)
exercising a real positive match.

**The fifth step is what this slice adds**: a controlled, hand-labelled
benchmark corpus (`apps/api/src/benchmark/`) and a CI-enforced safety
gate — see "Evaluation approach" above for the full design and current
results. Real historical migration pairs remain a deferred future
extension (see "Deferred" below), not a formal benchmark component yet.
Everything beyond these four rules (patch generation, additional rules,
automated changelog ingestion) remains unimplemented, and none of it
should be started without a separate planning/approval pass.

## Open questions

- Exact scoring/aggregation method when multiple pieces of evidence
  disagree — validated across four rules and two applicability
  boundaries (`AFFECTED` > `UNCERTAIN` > `NOT_AFFECTED` precedence across
  workspaces, see the tri-state section above); not yet validated against
  a rule needing genuinely different aggregation (e.g. weighing multiple
  distinct predicate matches within one workspace differently).
- Where the line sits between "deterministic rule matching resolves this"
  and "this needs AI reasoning" for a given rule — none of the four rules
  implemented so far needed an AI reasoning step; still undecided
  whether/when a future rule will.
- How `UNCERTAIN` results are surfaced to the user (vs. suppressed, vs.
  escalated for review) — currently just shown as-is with its reason
  (see the repositories page UI), no triage/escalation workflow exists.
- Whether/when the analyzer escalation ladder needs Level D (local data
  flow) or beyond — not needed by any of the four rules implemented so
  far, and the benchmark found no case demanding it; still not yet known
  for future rules.
- Per-call-site linking between a specific `new Stripe()` construction and
  a specific predicate match's effective `apiVersion` — every rule
  evaluates applicability at the workspace level from all evidence in
  that workspace, not proven per call site; multiple Stripe clients with
  different `apiVersion`s in one workspace conservatively yield `UNKNOWN`
  applicability rather than a precise per-call answer.

## Deferred

Additional rules beyond the four implemented, automated Stripe changelog
ingestion, `TransformationRecipe`/`VerificationExpectation`, real
historical migration-pair fixtures in the benchmark corpus, and all
patching/verification/PR automation downstream of impact analysis. This
document will be revised again as a fifth rule (or a materially different
predicate shape) validates or further generalizes the pipeline shape
above — treat it as a working hypothesis validated across four rules and
two applicability boundaries, not a finished spec.
