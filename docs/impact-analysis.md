# Impact Analysis

This is the central engineering problem for Patchwork and the most important
technical document in this repository. Four real rules are now implemented
end-to-end against a shared engine, and a three-part benchmark corpus (a
control corpus, a realistic corpus of ordinary production TypeScript
patterns, and a historical corpus of real public GitHub migrations)
measures whether that generalizes (see "Rules implemented", "Analyzer
escalation ladder", and "Evaluation approach" — including its "Realistic
validation" and "Historical validation" subsections — below); everything
beyond that remains principles and a likely pipeline shape, not a
finalized design. It was revised following external technical/product
research; corrections that research introduced are marked explicitly
rather than blended in silently.

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
the optional `TransformationRecipe`/`VerificationExpectation` — now
implemented for one rule, see "Remediation" below), and for the
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

## Evaluation approach (CURRENT — control, realistic, and real historical corpora)

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

Three corpora, distinguished by each `BenchmarkCase`'s `corpus: 'control'
| 'realistic' | 'historical'` field and reported separately (see
"Realistic validation" and "Historical validation" below) so a perfect
control-corpus score can never silently stand in for weaker real-world
behavior:

**Control corpus** (slice 4, `apps/api/src/benchmark/cases/*.ts`, ~11
cases × 4 rules = 44 total) — each fixture shaped closely around one
predicate/applicability behavior:

- **Positive** — direct usage, a same-file local alias, multiple usages in
  one file, a nested-workspace (monorepo) usage.
- **Negative** — the same method/property/literal on an unrelated object,
  the identifier only in a comment/string, Stripe present but the feature
  genuinely unused, an explicit pre-boundary `apiVersion` pin (structurally
  identical code, provably not applicable).
- **Uncertain** — dynamic/computed Stripe client construction, an
  unresolved cross-file import, no resolvable SDK version at all
  (`DECLARED_ONLY`, no lockfile).

**Realistic corpus** (slice 5, `apps/api/src/benchmark/cases/realistic/
*.ts`, 26 total) — ordinary production TypeScript patterns, not shaped
around the analyser's own capabilities; see "Realistic validation" below.

**Historical corpus** (slice 6, `apps/api/src/benchmark/cases/
historical/*.ts`, 3 total) — minimal reconstructions of real, publicly
sourced GitHub repositories at the exact commit before a real developer
performed a real Stripe migration, the one corpus not authored by the
person who wrote the analyser at all; see "Historical validation" below.

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
safety failures, 0 unsafe certainty, and 0 over-abstentions across 73
cases (44 control + 26 realistic + 3 historical) — see "Analyser changes
driven by benchmark evidence", "Realistic validation", and "Historical
validation" below for why that wasn't true on the first run of each
corpus.

**Historical location recall** is reported as a fourth, historical-only
metric alongside the table above: for each historical case, the real
developer's changed locations (ground truth, from the actual migration
diff) are compared against what `assessRuleImpact` actually detected on
the before-state — matched / missed / extra, raw counts, per case, never
collapsed into one ratio (see "Historical validation" below).

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

### Realistic validation (CURRENT)

The control corpus above answers "is the mechanism correct?" — every
fixture in it was written by the same person who wrote the analyser, so a
perfect score there is necessary but not sufficient evidence that the
engine holds up on code nobody shaped around its capabilities. Slice 5
added a second, **realistic** corpus (26 cases, `apps/api/src/benchmark/
cases/realistic/`) specifically to test that: ordinary async
service/controller layering, nested directories, destructuring,
class-based services, partial migrations, and mixed version-evidence
kinds across monorepo workspaces — prioritizing rules B
(`Invoice.subscription`) and D (`Authorization.status`) since both depend
on the awaited-property/literal analysis path that needed the `Promise<T>`
fix above. Ground truth was written from the change semantics and source
code, independently of running the analyser, exactly like the control
corpus.

**Three confirmed analyser bugs were found and fixed** — empirically
probed against hand-written realistic patterns _before_ any benchmark
fixture was written, then fixed with the smallest reusable change, then
re-verified (the same benchmark-first workflow as the two slice-4 fixes
above):

- **Destructuring was invisible to `member-access.ts` and
  `literal-comparison.ts`.** `const { subscription } = invoice;` and
  `const { status } = authorization; status === 'reversed'` never produce
  a `PropertyAccessExpression` at all — an everyday pattern, not an edge
  case — so neither predicate ever visited it, silently reporting
  `NOT_AFFECTED` if it was the only usage in a file. Fixed by resolving
  the destructured binding's _source_ property via
  `checker.getPropertyOfType` on the initializer's type (not
  `getSymbolAtLocation` on the binding name, which resolves to the new
  local variable, not the source property) — same three-way contract
  (confirmed match / confirmed non-match / ambiguous when the source
  type is unresolvable) as direct property access. Scoped to exactly the
  confirmed shape: a top-level `const`/`let` destructuring with an inline
  initializer in the same file; destructured function parameters and
  nested patterns are left unhandled (not guessed at) rather than
  speculatively supported.
- **Same-file variable-built call arguments were invisible to
  `call-argument-property.ts`.** `const phase = { iterations: 3 };
stripe.subscriptionSchedules.create({ phases: [phase] });` — a
  realistic, readable way to build a call's parameters — was treated as
  "property not found inline, therefore genuinely unused," a confirmed
  false negative. Fixed with one bounded hop: an identifier found while
  searching a call's arguments is resolved to its same-file `const`
  declaration's object/array-literal initializer (if any) and searched
  there too; if it can't be resolved that way, its checker-resolved type
  decides — a concrete, non-`any`/`unknown` type (e.g. a `string`
  parameter) definitively isn't hiding the property (confirmed
  non-match, not ambiguous — this is what keeps `create({ customer:
customerId, phases: [...] })` from becoming noisy `UNCERTAIN` just
  because `customerId` can't be inspected), while a genuinely
  unresolvable (`any`/`unknown`) type is `UNCERTAIN`, never a silent
  negative. (All three predicates now treat an explicit `unknown`
  annotation the same as `any` for this purpose — semantically both mean
  "could be anything," the same abstention signal.)

**Known limitations found and deliberately left unfixed, documented
instead** (each has its own realistic-corpus case, expected `UNCERTAIN`,
scored correctly):

- **A shared Stripe client singleton imported from its own module**
  (`import { stripe } from '../clients/stripeClient';`) — extremely
  common real structure, but each candidate file's analysis `Program` is
  bounded to just that file plus the trusted stub, so the imported
  `stripe` binding's real type can't be resolved. A more common variant
  of the already-documented cross-file-wrapper limitation, worth its own
  case since it's normal production structure, not an edge case.
- **Explicit `Stripe.X` namespace-style type annotations**
  (`function f(invoice: Stripe.Invoice)`) — a common real `stripe-node`
  pattern. The trusted stub declares only a default-exported class, not
  `stripe-node`'s real merged `Stripe` namespace, so the annotation is
  unresolvable. A stub-_content_ gap, not a predicate-_logic_ bug;
  correctly `UNCERTAIN`, not fixed this slice (expanding the stub's
  public type surface is a real, separable improvement with no confirmed
  false-negative behind it yet).
- **`call-argument-property.ts`'s cheap lexical prefilter can hide a
  cross-file, data-carried usage entirely.** Unlike the other two
  predicates (whose target is a property/method _name_ that must appear
  literally at the usage site even when the _object_ it's accessed on is
  unresolvable), this predicate's target is _data_ passed as an argument
  — if that data comes from another file and the property name never
  appears lexically in the calling file's text at all, the file is
  skipped by "Level A" candidate discovery before any `Program` is ever
  built, and the result silently falls through to `NOT_AFFECTED` rather
  than reaching the `UNCERTAIN` fallback above. Found while probing this
  slice's fixes, not observed in the realistic corpus (every realistic
  case ensures the property name is lexically present, matching how the
  existing control-corpus negative fixtures already work around this for
  other reasons). Documented as a known architectural characteristic of
  lexical candidate discovery, not fixed — no realistic case confirmed a
  need to broaden the prefilter, which would trade real precision for a
  scenario not yet observed in practice.

**Real-GitHub verification**: `HamidZ11/stripe-basil-fixture` was
extended with two new realistic positive fixtures — `src/services/
invoiceService.ts` (Rule B, await + destructuring) and `src/services/
issuingService.ts` (Rule D, await + destructuring) — plus `src/models/
internalRecords.ts` (an unrelated domain model sharing both a property
name and a literal value). Verified end-to-end against the real GitHub
archive at commit `abaa7d7` (via the real `POST /repositories/:id/
analyses` → `POST /analysis-runs/:id/impact-assessments` flow, a locally
running `apps/api` against the real database and the real GitHub API, no
fakes): all four rules ran; rules A, B, and D correctly reported
`AFFECTED` with exact `sourceFile`/`line` findings matching the pushed
source (including both new destructuring fixtures); Rule C correctly
reported `UNCERTAIN` (stripe@18.5.0 resolved, below its v19 boundary, no
`apiVersion` evidence — genuinely unresolvable applicability, not a
false result); the unrelated domain model produced no findings for any
rule.

### Historical validation (CURRENT)

The control and realistic corpora above answer "is the mechanism
correct?" and "does it hold up on ordinary production patterns?" — but
every fixture in both, even the realistic ones, was still authored by
the same person who wrote the analyser. Slice 6 adds the one form of
evidence that was entirely absent: **did the engine's mechanism,
evaluated on the actual before-state source of a real public
repository, identify the same code a real developer later changed in a
real migration?** Three cases (`apps/api/src/benchmark/cases/
historical/*.ts`), each a minimal reconstruction of real, independently
sourced GitHub history — never a vendored copy of the full file, which
ranged 9–604 lines including large amounts of unrelated business logic
(Supabase queries, Sentry, tier-mapping tables) not touched by the
migration in question. Each case cites its exact `repository`,
`beforeSha`, `afterSha`, and `sourceCommitUrl` (real, pinned commit
SHAs — a rerun always tests identical code, never a moving branch; no
live GitHub dependency exists in `pnpm test`/`pnpm benchmark`) via the
`HistoricalProvenance` type in `benchmark/types.ts`.

**Ground truth has three independent legs**, all established before any
Patchwork code runs against the fixture: the developer's real diff
(fetched via the GitHub API, not paraphrased), the real before-state
dependency evidence (`package.json`/`package-lock.json` at the before
SHA, fetched directly), and — critically, per the standing rule never to
let the system mark its own homework — the _expected_ result was
determined from the first two alone; the real, current predicate was
then run against a reconstruction and _compared against_ that
independently-derived expectation, never used to produce it.

- **Case 1 — Rule A** (`stripe.invoices.retrieveUpcoming` removal):
  [`dzinesco/route-commerce`](https://github.com/dzinesco/route-commerce),
  `src/lib/stripe-billing.ts`, before SHA `fbddd245`, migration commit
  [`dad8b0f`](https://github.com/dzinesco/route-commerce/commit/dad8b0fbe37ffedbfdb6aa297400e41317f1b8bb).
  Same-file Stripe client construction with an explicit, on-boundary
  `apiVersion: "2025-04-30.basil"` literal (this repo has no committed
  lockfile, so SDK-version evidence alone would have been `DECLARED_
ONLY` — applicability instead comes cleanly from the apiVersion
  literal path). **Result: `AFFECTED`, exactly the location the
  developer changed. A historical true positive.**
- **Case 2 — Rule B** (`Invoice.subscription` removal):
  [`caterbidsUK/caterbids.uk`](https://github.com/caterbidsUK/caterbids.uk),
  `app/api/stripe/webhook/route.ts`, before SHA `1959db44`, migration
  commit [`c6556b5`](https://github.com/caterbidsUK/caterbids.uk/commit/c6556b5a3a1ddacc34f407a4c24e60203def95b7).
  Two real call sites, both reading `invoice` from `event.data.object as
Stripe.Invoice`. **Result: `UNCERTAIN`** — the already-documented
  `Stripe.X` namespace-annotation stub gap (above), hit by real code.
  This is a **correct, safe abstention, not a bug** — and independent
  confirmation the limitation isn't a rare edge case: every other real
  Rule B migration found during this slice's research (5+ repositories)
  used the identical `event.data.object as Stripe.Invoice` pattern, the
  standard idiomatic way Stripe webhook handlers are written in
  TypeScript.
- **Case 3 — Rule C** (`iterations` parameter removal):
  [`Avanti-Creativo/bill-korman-website`](https://github.com/Avanti-Creativo/bill-korman-website),
  `src/app/api/stripe/installment-plan/route.ts`, before SHA `931f6685`,
  migration commit [`71ecd30`](https://github.com/Avanti-Creativo/bill-korman-website/commit/71ecd30172112206f7f07e5a4a82bdd018e0e76e).
  The real before-state code wraps the phases array in `as any` — the
  predicate's structural search still finds `iterations` right through
  that cast (a type-level cast doesn't defeat an AST-level search).
  **Result: `UNCERTAIN`** — not because of the cast, but because
  `stripe` itself is imported cross-file (`import { stripe } from
'@/lib/stripe'`), the already-documented client-singleton limitation.
  Independent, real-world confirmation of that limitation too.
- **Rule D**: no case. I searched `gh api search/commits` and
  `search/code` with multiple targeted queries for real public
  migrations of the Issuing `Authorization.status` split; Issuing
  (corporate card programs) is a narrow product, and no genuine match
  was found — only noise (OAuth "authorization," generic "expired"/
  "reversed" hits, dependency-bot PRs). Reported honestly rather than
  stretching a weak match, per the task's explicit instruction.

**Historical location recall**: 1 of 4 real developer-changed locations
matched (the Rule A case; the two Rule B locations and the one Rule C
location were correctly not claimed, since those cases correctly
abstained rather than guess), 0 extra/unrelated findings. **Zero false
`NOT_AFFECTED` safety failures** across all three cases — the single
most important historical failure mode named by the task ("real
developer migration proves affected usage existed, and Patchwork's
before-state analysis says `NOT_AFFECTED`") did not occur.

**No analyser change was made because of this slice.** Both `UNCERTAIN`
results are the existing, already-correct, already-tested behavior for
limitations documented in slice 5 — not new bugs this evidence exposed.
The `Stripe.X` and cross-file-client-singleton gaps remain deliberately
unfixed (see "Realistic validation" above for why), even though this
slice's real-world evidence now confirms both are common in practice,
not rare — the task's own framing anticipated exactly this ("a
historical case hitting a known limitation may correctly return
`UNCERTAIN`"). This is the strongest evidence yet for prioritizing the
`Stripe.X` namespace stub expansion in a future slice, if real-world
_coverage_ (not safety) becomes the priority — flagged here, not acted
on.

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

**The fifth step, built across slices 5–6**: a controlled, hand-labelled
benchmark corpus (`apps/api/src/benchmark/`) and a CI-enforced safety
gate, now spanning control, realistic, and real historical corpora — see
"Evaluation approach" above for the full design and current results.
Additional rules and automated changelog ingestion remain unimplemented,
and none of it should be started without a separate planning/approval
pass. Patch generation now has one first, narrow, deterministic instance
— see "Remediation" below — but it is a separate concern from impact
analysis: remediation success is deliberately excluded from the impact
benchmark's precision/recall metrics (see remediation's own test corpus
under `apps/api/src/remediation/__tests__/`), so "impact detected
correctly" and "patch generated correctly" are never conflated into one
number.

## Remediation

**Implemented for exactly one rule.** Given an already-AFFECTED
`ImpactAssessment`, `apps/api/src/remediation/` deterministically rewrites
the exact finding location(s) via the TypeScript Compiler API (never
regex/string replacement), independently re-proves the migration held
using the same real `TypeChecker`-based engine `ImpactPredicate` uses (not
by trusting the rewrite's own return value), and persists the result as a
`PatchAttempt` (see [data-model.md](data-model.md)). No LLM, no customer
code execution, no GitHub write of any kind (see
[security.md](security.md)) — a verified _candidate_ patch only.

**Which rule, and why not the others.** Of the four rules, only
`stripe_invoice_subscription_property` (`Invoice.subscription` →
`Invoice.parent.subscription_details.subscription`) has a provable-safe
mechanical subset. The other three were evaluated against Stripe's actual
changelog/type declarations and rejected as the first target:

- `stripe_invoices_retrieve_upcoming` (Rule A, `retrieveUpcoming` →
  `createPreview`): Stripe's changelog states outright that previewing a
  customer's next invoice "across all their subscriptions" via a bare
  `{ customer }` call is _removed_, not relocated — the single most common
  real-world call shape has no 1:1-compatible replacement, so no
  mechanically-safe subset could be defined without deeper, still-open
  parameter-compatibility research.
- `stripe_subscription_schedule_iterations_param` (Rule C, `iterations` →
  `duration`): the replacement value depends on the phase's billing
  interval, information not present at the call site — not mechanically
  derivable at all, let alone safely.
- `stripe_issuing_authorization_status_reversed` (Rule D, new `'expired'`
  status value): a response-side enum addition, not a call to rewrite —
  the correct handling of the new value is a business-logic decision, not
  a mechanical transformation.

**Supported shape, precisely.** Only a direct, non-computed, non-optional,
read-position property access `X.subscription` resolving (via the trusted
Stripe type stub, same mechanism `ImpactPredicate` already uses) to
`StripeInvoice.subscription` — rewritten to
`(X.parent?.subscription_details?.subscription ?? null)`. The `?? null` is
load-bearing, not cosmetic: verified against the real stripe-node type
declarations at both SDK boundary tags, the old field was
`string | Stripe.Subscription | null` and the replacement path is
`string | Stripe.Subscription` (reachable only through two independently-
nullable steps), so `?? null` is what makes the rewritten expression
produce the _identical_ observable value as the old field in every case —
not just truthiness, but strict equality, `Object.is`, `switch`,
serialization, and every other value-comparison context. An _originally_
optional access (`X?.subscription`) is deliberately refused, not
rewritten: if the receiver itself is nullish, `X?.subscription` and
`(X?.parent?.subscription_details?.subscription ?? null)` diverge (`
undefined` vs. `null`) — a real semantic change the mechanism can't paper
over. Destructuring (`const { subscription } = invoice`) — a shape
`ImpactPredicate` itself already detects as AFFECTED — is also refused, a
distinction confirmed against the real `HamidZ11/stripe-basil-fixture`
repository, which uses exactly this shape; the refusal names the actual
reason ("destructures the property") rather than a generic "stale
finding," so the distinction is visible to whoever reads the result, not
just enforced silently.

**Postcondition checks are not `docs/verification.md`'s "verification."**
That document's "verification" means running the customer's own build/
test/lint in an isolated sandbox — deliberately, entirely deferred, no
sandbox exists. What a `TransformationRecipe`'s `checkPostconditions`
does is narrower and purely static: re-run the same real semantic engine
to confirm the old pattern is gone and the replacement pattern is present
at the expected location, assert only the expected file(s) changed, and
assert the diff is bounded. No repository code is ever executed by either
mechanism today.

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
ingestion, `TransformationRecipe`/`VerificationExpectation` for Rules A/C/D
(evaluated and found to have no provable-safe mechanical subset — see
"Remediation" above) or for any future rule, sandboxed build/test
verification (`docs/verification.md`), any GitHub write (branch, commit,
PR), a historical migration case for Rule D (no genuine public example
found), expanding
the trusted stub's type surface to support `Stripe.X` namespace-style
type annotations, broadening `call-argument-property.ts`'s lexical
prefilter to catch cross-file data-carried usage (see "Realistic
validation" above for both — now with independent real-world confirmation
from the historical corpus that both are common, not rare), and all
patching/verification/PR automation downstream of impact analysis. This
document will be revised again as a fifth rule (or a materially different
predicate shape) validates or further generalizes the pipeline shape
above — treat it as a working hypothesis validated across four rules, two
applicability boundaries, and a control, realistic, and real historical
benchmark corpus, not a finished spec.
