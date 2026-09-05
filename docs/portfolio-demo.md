# Patchwork demo guide

A reference for demonstrating Patchwork and answering the questions that follow. Not part of the
marketing site.

## 30-second explanation

> When Stripe changes its API, a changelog tells you what changed — it can't tell you whether _your_
> repository is affected. Patchwork takes a repository at an exact commit, resolves which version of
> the SDK is actually installed from the lockfile, and uses the TypeScript compiler to find whether
> the affected API is genuinely used and exactly where. If it is, and if the migration is one it can
> prove is safe, it rewrites the code deterministically, runs the project's own install, typecheck
> and tests in an isolated sandbox, and opens a pull request. The interesting part is what it
> refuses to do: it has a three-state verdict, and failing to prove impact never becomes "you're
> fine".

If asked "so it's an AI tool?": the analysis is entirely deterministic. A model is used in exactly
one place — turning evidence Patchwork has already proven into plain English — and it cannot change
a verdict.

## 2-minute demo flow

1. **Landing page** (`/`) — the narrative: changelog → applicability → findings → patch →
   verification → PR.
2. **Repositories index** (`/repositories`) — an estate view. One repository Affected, one Clear,
   with the resolved SDK version and analysed commit on each row.
3. **Open the affected repository's impact report.** Point at the header: commit `d2b1ca5`, Stripe
   SDK `18.5.0`. Every verdict below is a statement about _that_ commit.
4. **The assessment selector** — four real Stripe changes, three `Affected`, one `Uncertain`. Open
   the `Uncertain` one first and explain why that state exists: the evidence did not reach, so
   Patchwork abstains rather than guessing.
5. **Exact findings** — `src/services/invoiceService.ts:15`, the matched expression. Compiler
   resolved, not a grep hit.
6. **AI explanation** — expand it. Note the header says _AI explanation_ and the footer says the
   deterministic verdict remains the source of truth. Point out the evidence chips: they come from
   the assessment, not the model.
7. **Deterministic patch** — the generated diff, `invoice.subscription` →
   `invoice.parent?.subscription_details?.subscription ?? null` across two files. Emphasise: no
   model wrote this.
8. **Verification** — the sandbox run with per-step outcomes. A step that did not run says so.
9. **Pull request** — opened, not merged. Patchwork stops here by design.

Good closing line: _three of the four changes have no automatic fix, and Patchwork says so instead
of attempting one._

## Questions to be ready for

**Why the TypeScript Compiler API instead of regex?**
Regex cannot distinguish `invoice.subscription` on a Stripe `Invoice` from the same property name on
an unrelated local object, and it cannot follow imports, aliases or re-exports. Lexical scanning is
used only to narrow candidates; the proof comes from a `Program` and `TypeChecker` agreeing the
reference resolves to the affected symbol. A false `NOT_AFFECTED` is the most damaging output this
system can produce, so the proof step has to be semantic.

**Why a tri-state verdict instead of a boolean?**
Because "we could not prove impact" and "we proved there is no impact" are different claims, and
collapsing them silently converts ignorance into reassurance. `NOT_AFFECTED` requires positive
negative evidence. Everything unresolved, unknown or dynamic becomes `UNCERTAIN`. The benchmark
gates on zero false `NOT_AFFECTED` results precisely because that is the failure that would matter.

**Why deterministic fixes instead of letting an LLM write them?**
A patch that is _probably_ right is worse than no patch, because it consumes review attention while
looking authoritative. Each recipe is an explicitly implemented transformation whose value-preserving
behaviour was verified against Stripe's own type declarations for the specific call shape. Where
that proof isn't available, Patchwork refuses the whole attempt rather than emitting a partial patch.
That standard is why only one of four rules has a recipe — the other three were evaluated and
rejected with recorded reasons.

**Why sandbox customer code at all?**
Verification means running the repository, and `npm install` alone executes arbitrary lifecycle
scripts. That is untrusted code execution, not a setup step. It happens in an E2B sandbox that
receives `{ CI: '1', NODE_ENV: 'test' }` and no credentials — no GitHub token, no App private key, no
database URL, no OpenAI or E2B key. The API and worker processes never execute repository code.

**Why separate `RepositorySnapshot` and `AnalysisRun`?**
A snapshot is a repository at an exact SHA; an analysis run is one evaluation of a rule set against
it. Separating them means re-analysing with an improved analyser produces a _new_ assessment rather
than silently rewriting an old answer, so a verdict is always attributable to both the code and the
analyser version that produced it — which is what makes results auditable.

**Why a Postgres-backed queue instead of Redis?**
The jobs are rows about rows already in Postgres, so `SELECT … FOR UPDATE SKIP LOCKED` gives atomic
claiming with a stale-lease recovery path and no second datastore to operate, back up or keep
consistent. At this volume a broker would add operational surface without solving a problem the
database doesn't already solve.

**How does GitHub authentication work?**
A GitHub App, two credential paths. User sign-in is OAuth, producing a session whose token is stored
only as a hash. Repository access uses short-lived installation tokens minted from the App private
key on demand — never persisted, never sent to the browser, never given to the sandbox.

**How does Patchwork avoid sending repository code to OpenAI?**
The explanation endpoint builds a small server-side projection of already-persisted facts: the
verdict, the change title, applicability reasons, up to five findings as `path:line:symbol`, the
migration text, and remediation/verification/PR state. Roughly a kilobyte. No file contents, no
archive, no credentials — and a test asserts the payload's exact key set and that it contains none of
the fixture's source markers.

**What stops the model from claiming something false?**
Three layers. It only receives established facts. Its output is a strict structured response,
schema-validated with length caps before storage, so an invalid generation is never cached as a
success. And the UI renders it as a labelled, subordinate block that states the deterministic verdict
remains the source of truth.

## Limitations

- GitHub, Stripe, TypeScript and `stripe-node` only.
- Four provider-change rules; one deterministic remediation recipe.
- One repository analysed at a time; analysis is user-triggered, not scheduled.
- Analysis resolves at module scope — cases needing deeper interprocedural data flow return
  `UNCERTAIN` by design rather than being answered.
- Billing, teams and multi-tenant estate management do not exist.
- On the small historical corpus, verdict correctness held — Patchwork reached the right conclusion
  for every case. Exact source-location recovery was incomplete in some of those cases: it did not
  surface every location a human found in the real migration. Verdict correctness and location
  coverage are measured as separate quality dimensions on purpose, because a correct verdict with
  partial locations and a wrong verdict are very different failures.

## Future direction

More providers beyond Stripe. More languages beyond TypeScript. Broader rule coverage, and more
remediation recipes as each is proven safe. Deeper impact semantics for the cases that currently
return `UNCERTAIN`. Repository-estate support for teams.
