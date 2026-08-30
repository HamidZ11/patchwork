# Patch Generation

Not yet implemented. This records principles ahead of the implementation
slice, which comes after impact analysis is trustworthy — patch generation
is secondary to correctly identifying impact.

## Principles (DECIDED BUT NOT IMPLEMENTED)

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

- Rule-based codemods vs. LLM-assisted generation vs. a hybrid — not
  decided; likely depends on what impact analysis's evidence actually looks
  like once that exists.
- How "minimal" is mechanically enforced (diff size limits, scoping rules).
- How a `PatchAttempt` is represented before verification (in-memory diff,
  branch, working tree) — see [verification.md](verification.md).

## Deferred

The entire patch generation engine, including any AI/LLM usage.
