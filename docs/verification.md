# Verification

**Sandboxed build/test/lint verification, as described in this document,
is not yet implemented** — this still records principles ahead of that
slice. A different, narrower thing now exists and should not be confused
with it: each `TransformationRecipe`'s `checkPostconditions`
(`apps/api/src/remediation/`) independently re-proves a rewrite via the
same static, real TypeChecker-based engine impact analysis uses — no
`npm install`, no build, no test, no code execution of any kind. See
[impact-analysis.md](impact-analysis.md#remediation) for what it actually
checks. Everything below this point is about the sandbox-execution
concept, which remains entirely deferred.

## Principles (DECIDED BUT NOT IMPLEMENTED)

- **Generated code is never trusted automatically.** A `PatchAttempt` is
  not proposed to a customer until it has passed verification — generation
  proposes, verification (and policy) decide what's allowed to reach a PR.
- **Repository code is untrusted, and so is the verification process
  itself.** Verification necessarily runs the customer's own repository
  (build, tests) — this is customer code execution, with the same trust
  implications as any other repository execution. See
  [security.md](security.md).
- **Package installation is code execution, not a safe setup step.**
  `npm install` / `pnpm install` can run arbitrary install scripts from the
  repository's own `package.json` and its dependency tree. It must be
  treated with the same isolation as running the repository's own code, not
  assumed safe because it's "just installing dependencies."
- **Verification occurs in isolation**, never directly inside the `apps/api`
  or `apps/worker` process/environment.

## Likely checks (PROPOSED)

Typecheck, lint, tests, build — using the target repository's own existing
tooling/scripts where possible, rather than Patchwork imposing its own
standards on customer code.

## Open questions

- Exact sandbox design (container-per-run, ephemeral VM, etc.) — **remains
  a future explicit architecture decision**, not assumed here.
- Where verification runs operationally (triggered from `apps/worker`, but
  executed where).
- Time/resource limits for a verification run.
- What happens when a customer's own test suite is flaky or slow — not yet
  considered.

## Deferred

The entire verification pipeline and its sandbox. `apps/worker` exists as
the future home for triggering this, but runs no jobs today.
