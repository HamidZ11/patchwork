# Verification

Two distinct things share the word "verification" in this codebase and
must not be confused:

- **Static postcondition checks** (`apps/api/src/remediation/`,
  `TransformationRecipe.checkPostconditions`) — re-prove a rewrite via the
  same static, real TypeChecker-based engine impact analysis uses. No
  `npm install`, no build, no test, no code execution of any kind. See
  [impact-analysis.md](impact-analysis.md#remediation) for what it checks.
- **Sandboxed install/typecheck/test verification** (`apps/worker/src/
verification/`, this document) — actually runs a candidate patch's
  install and commands inside an isolated E2B sandbox to produce real
  pass/fail evidence. **IMPLEMENTED**, described in full below.

## Status summary

**IMPLEMENTED**: patch application (check + apply), package-manager/Node
detection with explicit refusal on unsupported/conflicting evidence,
install with an allowlisted-network policy, a hard network lockdown before
verification commands, typecheck + test execution, bounded log capture,
persistence (`VerificationRun`/`VerificationStep`), a Postgres lease-based
worker claim queue with crash recovery, a provider-agnostic `SandboxRunner`
abstraction with a real E2B adapter, the `POST /patch-attempts/:id/
verification-runs` + `GET /verification-runs/:id` API, and a runtime
verification UI on the impact-detail page.

**NOT PROVEN LIVE**: the E2B adapter has never actually created a sandbox
against E2B's real infrastructure in this environment, because no
`E2B_API_KEY` has been configured here — see "Not implemented / not proven
live" below. Everything else has been verified against the real pipeline
and a `FakeSandboxRunner`.

**NOT IMPLEMENTED**: build/lint verification, any GitHub write (branch,
commit, PR), automatic retries, arbitrary/customizable commands, broader
network access than the allowlisted install registry, and any provider
beyond Stripe/TypeScript.

## Principles (IMPLEMENTED)

- **Generated code is never trusted automatically.** A `PatchAttempt` is
  not proposed to a customer until it has passed verification — generation
  proposes, verification (and policy) decide what's allowed to reach a PR.
  Demonstrated end to end for the one implemented remediation rule; still
  true in principle for any future rule.
- **Repository code is untrusted, and so is the verification process
  itself.** Verification runs the customer's own repository (install,
  typecheck, test) — this is customer code execution, with the same trust
  implications as any other repository execution. See
  [security.md](security.md).
- **Package installation is code execution, not a safe setup step.**
  `npm install` / `pnpm install` / `yarn install` can run arbitrary install
  scripts from the repository's own `package.json` and its dependency
  tree. Lifecycle scripts are deliberately **allowed** to run (not
  `--ignore-scripts`) — suppressing them would produce misleading false
  failures, and the sandbox exists specifically to contain this execution,
  not to avoid it.
- **Verification occurs in isolation**, never directly inside the
  `apps/api` or `apps/worker` process/environment — an E2B microVM sandbox,
  created and destroyed entirely within `apps/worker`, is the only place
  any of this ever executes.

## What runs (IMPLEMENTED)

Exactly three steps, in this order, using the target repository's own
existing package manager and scripts — Patchwork does not impose its own
tooling or standards on customer code:

1. **Patch apply** — a two-stage check/apply (`apps/worker/src/
verification/patch-apply.ts`): `patch -p0 --forward --dry-run` then
   `patch -p0 --forward`, against the exact `RepositorySnapshot` the
   `PatchAttempt`'s diff was generated from. `-p0` matches the diff format
   Patchwork's own `diff` package produces (no `a/`/`b/` prefix);
   `--forward` is load-bearing — without it, `patch` can silently
   reverse-apply an already-applied target under non-interactive stdin.
   Patch application failure is `PATCH_FAILURE`; Patchwork never repairs
   or regenerates the patch inside the sandbox.
2. **Install** — the repository's detected package manager (`npm` / `pnpm`
   / `yarn`, including the Yarn Classic vs. Berry flag difference),
   installed with the outbound network **allowlisted only to the exact
   registry host that package manager requires** — no arbitrary internet
   access. Package-manager conflicts (a `packageManager` field that
   disagrees with the lockfile present) and any evidence of a custom
   registry both **refuse** rather than guess, matching the same
   never-guess-on-conflicting-evidence posture as impact analysis's own
   lockfile evidence handling.
3. **Typecheck and test** — both always run once install passes,
   regardless of each other's outcome, so a failed typecheck never hides a
   test result. Only exact, trusted script names are recognized (no
   speculative synonyms). **Build and lint are deliberately not run** —
   narrower v1 scope, not an oversight.

Network access is locked down to deny-all (`SandboxRunner.updateNetwork`)
before typecheck/test ever run — those commands never have any outbound
network access, allowlisted or otherwise.

**Stop-on-failure policy**: patch-apply failure or install failure stops
the run immediately (nothing downstream is meaningful). Total-timeout,
sandbox-infrastructure, or policy failures also terminate the run
immediately regardless of where it was.

## Node version policy (IMPLEMENTED)

An explicit, unsupported declared Node version/range **refuses** — never
silently substitutes a different major. When a repository declares no Node
version at all, Patchwork uses one documented default from its own sandbox
template and records that fallback explicitly (`VerificationRun
.nodeVersionSource = 'patchwork_default'` vs. `'repository'`) — a `PASSED`
result under the default is "verified under Patchwork default Node X," not
"verified under the repository's declared runtime," and the UI makes this
distinction visible (see "Runtime verification UI" below).

## Manifest (IMPLEMENTED)

Every sandbox run is driven by a `VerificationManifest`
(`apps/worker/src/verification/manifest.ts`,
`apps/worker/src/verification/types.ts`) — server-generated only, never
accepted from client input, versioned (`version: 1`), and persisted for
reproducibility. Records: the exact snapshot/patch identity (`PatchAttempt`
id, diff SHA-256), sandbox template identity, detected Node
version/source, package manager + version, the install command, the
recognized verification commands, timeout policy, and network policy
(`install`: allowlist; `verify`: deny-all). No arbitrary command field
exists anywhere in this shape or in the public API.

## Sandbox provider (IMPLEMENTED for the adapter; NOT PROVEN LIVE)

E2B was selected after a documented comparison against Vercel Sandbox (see
[architecture.md](architecture.md) for the broader infrastructure
reasoning). `apps/worker/src/verification/sandbox-runner.ts` defines a
provider-agnostic `SandboxRunner` interface (`create` / `writeFiles` /
`runCommand` / `updateNetwork` / `destroy`); `e2b-sandbox-runner.ts` is the
real E2B adapter, and no E2B-specific type is ever visible outside that one
file. A `FakeSandboxRunner` (test-only) implements the same interface for
the full worker test suite.

**The E2B adapter itself has never executed against real E2B
infrastructure in this environment** — no `E2B_API_KEY` has been
configured here, and `apps/worker` refuses to boot without one (verified
directly: `loadWorkerConfig` throws on a missing key). Everything upstream
and downstream of the actual sandbox call — manifest derivation, patch
apply logic, the claim queue, persistence, the API, and the UI — has been
verified against the real pipeline with the fake runner, and against a
real GitHub repository (`HamidZ11/stripe-basil-fixture`) through the point
of enqueuing a real `PENDING` `VerificationRun`. Building the E2B template
(`pnpm --filter @patchwork/worker build-e2b-template`) and a live sandbox
run both remain blocked pending a real API key.

## Security boundary (IMPLEMENTED)

The sandbox never receives: a GitHub installation token, the GitHub App
private key, `DATABASE_URL`, the session secret, the E2B API key itself,
any other Patchwork production secret, or a host mount. It receives only:
the exact repository snapshot contents required for verification, the
persisted candidate patch, the derived `VerificationManifest`, and a
minimal safe environment (`CI=1`, `NODE_ENV=test`). A `PASSED` result means
"this patch passed these exact commands in this exact isolated
verification environment," not "this patch is universally correct" — the
customer's source remains fully untrusted even after a pass. Full threat
model: [security.md](security.md).

## Data model (IMPLEMENTED)

`verification_runs` + `verification_steps` — see
[data-model.md](data-model.md) for the full column-level detail. Kept as
separate tables/concepts from `patch_attempts`, never overloading
`PatchAttempt.status`: static postcondition success (`PatchAttempt
.status = 'GENERATED'`) is not runtime verification success, and only an
actual completed sandbox run can produce `VerificationRun.status =
'PASSED'`.

`VerificationRun.status`: `PENDING | RUNNING | PASSED | FAILED | REFUSED |
TIMED_OUT | INFRA_ERROR`. `VerificationRun.failureCategory` (set alongside
a non-`PASSED` status): `CUSTOMER_REPO_FAILURE | PATCH_FAILURE |
POLICY_REFUSAL | SANDBOX_INFRA_FAILURE | TIMEOUT` — deliberately a second,
independent dimension rather than folding the reason into `status` itself,
so e.g. two different `FAILED` runs (a failing test suite vs. a patch that
wouldn't apply) remain distinguishable.

## Worker claim queue (IMPLEMENTED)

`apps/worker/src/verification/queue.ts` — `SELECT ... FOR UPDATE SKIP
LOCKED` inside a transaction for atomic claim, no separate queue
infrastructure (matching [ADR-002](adr/0002-drizzle-for-postgres-access.md)'s
"Postgres is the only datastore" stance). A bounded lease
(`claimed_by`/`claimed_at`/`lease_expires_at`) means a worker crash can
never leave a `VerificationRun` stuck `RUNNING` forever: `recoverStaleClaims`
reclaims any `RUNNING` row whose lease has expired as `INFRA_ERROR`
(`SANDBOX_INFRA_FAILURE`), called on every worker poll. **No automatic
retries exist** — every `VerificationRun` is immutable, audit-log style;
a recovered `INFRA_ERROR` stays `INFRA_ERROR`, and a user can explicitly
request a new run later (`POST /patch-attempts/:id/verification-runs`
again). This has been verified with unit/integration tests (including a
two-workers-racing-for-one-row test and a lease-expiry-recovery test), not
under production-scale concurrent load — see "Not implemented / not proven
live" below.

## Bounded logs (IMPLEMENTED)

`apps/worker/src/verification/output.ts` caps stdout/stderr per step
(8 KiB each) and total persisted output per run (32 KiB), by bytes (UTF-8
boundary-safe), never by character count, and never relying on the sandbox
provider to bound output itself. `VerificationStep.truncated` is recorded
whenever a cap was hit; sandbox output is never copied into normal
Patchwork application logs — logs remain owner-visible only, surfaced
through the API/UI, not through Patchwork's own operational logging.

## API (IMPLEMENTED)

`POST /patch-attempts/:id/verification-runs` — authenticates,
ownership-scopes the `PatchAttempt`, requires `status = 'GENERATED'`,
returns an existing in-flight (`PENDING`/`RUNNING`) run instead of creating
a duplicate, otherwise inserts a new `PENDING` row. Never touches a
sandbox itself, never downloads an archive, never sees a GitHub token —
`apps/worker`'s poll loop does all of that asynchronously.
`GET /verification-runs/:id` — ownership-scoped full detail including
steps. `GET /analysis-runs/:id` also embeds each `PatchAttempt`'s
`VerificationRun`s (with steps) for the impact-detail page, via a
read-only join (`apps/api/src/verification/persistence.ts`) — no new
write surface. See `apps/api/src/routes/verification-runs.ts`.

## Runtime verification UI (IMPLEMENTED)

`apps/web/src/app/analysis-runs/[id]/page.tsx` — under each `PatchAttempt`
that's `GENERATED`, a "Runtime verification" section renders distinct
wording for all seven `VerificationRun` statuses (never collapsed to
generic success/failure), `FAILED` further distinguished by
`failureCategory` (a patch that wouldn't apply vs. a customer-repo
failure), a dense per-step list with bounded stdout/stderr behind
disclosures (visibly marking truncated output), an environment-evidence
disclosure (commit SHA, sandbox provider/runtime, Node version with
explicit default-vs-declared wording, package manager, manifest version),
and a "Verify in sandbox" / "Verify again" action that is hidden while a
run is `PENDING`/`RUNNING` to prevent duplicate submissions in the UI, in
addition to the API's own in-flight guard. No command customization is
exposed anywhere. One small client component (`VerifySubmitButton`) for
submit-pending feedback; no client-side polling — the page relies on
manual reload, matching the rest of this MVP's UI.

## Not implemented / not proven live

- **No GitHub branch, commit, or PR creation.** Generating and persisting
  a `PatchAttempt`, and running it through sandbox verification, is not an
  action against the customer's repository — GitHub write access remains a
  separate, not-yet-implemented, explicitly-authorized capability.
- **No GitHub write permissions of any kind** exist in this slice.
- **No LLM repair.** All remediation and verification logic here is
  deterministic; no model is in this loop.
- **No build/lint verification** — only install, typecheck, and test are
  recognized (see "What runs" above); this is a deliberate v1 scope
  boundary, not an oversight.
- **No arbitrary commands.** The verification command set is a small,
  hardcoded, server-derived allowlist; no field anywhere accepts a
  caller-supplied command.
- **No secrets injection.** The sandbox never receives any Patchwork
  secret or credential — see "Security boundary" above.
- **No broader provider or language support.** Stripe/TypeScript only,
  matching the rest of Patchwork's MVP scope.
- **Live E2B execution has not yet been proven** in this environment — no
  `E2B_API_KEY` has been configured, so no sandbox has ever actually been
  created against E2B's real infrastructure here. See "Sandbox provider"
  above for exactly what has and hasn't been exercised.
- **No production-scale worker/queue validation.** The lease/claim
  mechanism is verified by unit and integration tests (including a
  two-worker race test), not by load testing, multiple concurrently
  running workers in a real deployment, or real-world crash/recovery
  timing.

## Open questions

- Whether/when automatic bounded retries are justified for
  `SANDBOX_INFRA_FAILURE` runs, once real provider-failure data exists
  (deliberately deferred, not designed, for v1).
- Exact policy for a customer's own test suite being flaky or slow beyond
  the fixed per-command/total timeout budget already enforced.
- Whether/when the install network allowlist needs to grow beyond the
  package-manager registries it covers today — the v1 policy refuses
  (`POLICY_REFUSAL`) rather than silently widening network access; any
  expansion should be driven by real evidence of a legitimately-needed
  host, not speculative broadening.
