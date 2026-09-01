# Patch Generation

**Implemented for exactly one rule** (CURRENT) — see
[impact-analysis.md](impact-analysis.md#remediation) for the full design,
supported/refused shapes, and why the other three rules don't have one
yet. Everything else below is still principles ahead of a broader
implementation; the rest of patch generation remains secondary to
correctly identifying impact.

## What exists today (CURRENT)

`apps/api/src/remediation/` — given an already-AFFECTED
`ImpactAssessment` for `stripe_invoice_subscription_property`, a
hardcoded, versioned `TransformationRecipe`
(`recipes/invoice-subscription-to-parent.ts`) deterministically rewrites
`Invoice.subscription` reads to
`(X.parent?.subscription_details?.subscription ?? null)` using the
TypeScript Compiler API against the exact `RepositorySnapshot` archive,
independently re-verifies the rewrite via the same real semantic engine
impact analysis uses, and persists the result as a `PatchAttempt`
(`POST /impact-assessments/:id/patch-attempts`). Rule-based codemod, not
LLM-assisted — see "Open questions" below, now partly answered for this
one case. No GitHub write, no code execution — see
[security.md](security.md).

## Principles (DECIDED, now demonstrated for one rule)

- **Smallest correct migration.** A patch addresses exactly the
  `AffectedLocation`s identified by impact analysis — not a wholesale
  rewrite, not incidental cleanup.
- **Constrained context.** Generation works from the targeted context impact
  analysis extracted (the specific affected usages and their surrounding
  code), not the whole repository.
- **No unrelated refactoring.** The patch must not touch code unrelated to
  the identified change, even if it looks like an improvement.
- **Structured output, not free-form diffs.** Follows the same shape as any
  AI capability in this system — see "AI system principles" in
  [CLAUDE.md](../CLAUDE.md#ai-system-principles): typed input, structured
  output, schema validation — not an LLM directly emitting a raw diff to be
  trusted as-is.
- **Policy validation before application.** A generated patch is checked
  against deterministic policy (e.g. scope limits, forbidden paths) before
  it's applied to anything — generation proposes, policy decides what's
  permitted to proceed.
- **Applied against a precise snapshot.** Patching occurs against a specific
  `RepositorySnapshot` (a known commit), never against a moving/ambiguous
  target — see [data-model.md](data-model.md).

## Open questions

- Rule-based codemods vs. LLM-assisted generation vs. a hybrid — decided
  for exactly one rule (rule-based, no LLM) because a provable-safe
  mechanical subset existed for it; still undecided for any rule where one
  doesn't (Rules A/C/D so far, and any future rule) — not assumed to
  generalize.
- How "minimal" is mechanically enforced — answered for the one
  implemented rule (a bounded unified-diff character cap, a forbidden-path
  policy, whole-attempt refusal over partial patching — see
  [security.md](security.md)); not yet generalized beyond it.
- How a `PatchAttempt` is represented before verification — answered for
  the one implemented rule: a `patch_attempts` row (unified diff + a
  structured postcondition result), never a branch or working tree — see
  [data-model.md](data-model.md) and [verification.md](verification.md).

## Deferred

The rest of the patch generation engine beyond the one rule above,
including any AI/LLM usage.
