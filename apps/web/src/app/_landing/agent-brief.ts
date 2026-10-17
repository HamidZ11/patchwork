/**
 * The Markdown brief the landing header's `agent.md` button copies, written
 * for a coding agent (Claude Code, Cursor) a developer pastes it into.
 *
 * Every claim here is checked against the code, not the marketing copy:
 * rules and version boundaries in apps/api/src/analysis/impact/rules/,
 * lockfile support in apps/api/src/analysis/evidence/lockfiles.ts,
 * verification in apps/worker/src/verification/, and the branch, title and
 * body of a pull request in apps/worker/src/pull-requests/policy.ts. When
 * any of those change, change this too.
 */
export const AGENT_BRIEF = `# Patchwork: agent brief

You are helping a developer set up and use Patchwork on one of their repositories. Use only what is written here. If something is not covered, say so rather than guess.

## What Patchwork does

Patchwork checks whether a tracked Stripe API change affects a TypeScript repository that uses \`stripe-node\`. For one exact commit it:

1. Reads the installed \`stripe\` version from the lockfile, not the range in \`package.json\`.
2. Finds candidate usages with a text search, then confirms each one with the TypeScript compiler (\`Program\` / \`TypeChecker\`).
3. Gives each tracked change a verdict: \`AFFECTED\` (a confirmed usage, with file and line), \`NOT_AFFECTED\` (proof the change does not apply) or \`UNCERTAIN\` (anything it cannot resolve; it never guesses either way).
4. Where it can prove a rewrite keeps the same behaviour for that exact code, prepares a deterministic fix (no language model writes code), runs the repository's own install, \`typecheck\` and \`test\` in an isolated E2B sandbox, and only after that run passes, opens a pull request.

An optional AI explanation describes a verdict in plain English. It sees a short summary of the findings, never source files, and cannot change a verdict.

## Requirements

- A GitHub repository written in TypeScript that depends on \`stripe\` (\`stripe-node\`).
- A \`package-lock.json\` or \`pnpm-lock.yaml\` that resolves an exact \`stripe\` version. \`yarn.lock\` is detected but not parsed, so the version is unknown and verdicts are \`UNCERTAIN\` unless the code pins an explicit \`apiVersion\`.
- The tracked changes apply from \`stripe\` v18 (Stripe API \`2025-03-31\`, Basil) and v19 (\`2025-09-30\`, Clover). An \`apiVersion\` passed to the Stripe client as a literal or local constant is also used as evidence.
- For sandbox verification: npm, pnpm or yarn against the public registry (a custom or private registry is refused), and Node 20. A Node version declared in \`engines.node\`, \`.nvmrc\`, \`.node-version\` or Volta must include 20; with no declaration, Node 20 is used and labelled as Patchwork's default.

## Setup

Nothing is added to the repository: there is no Patchwork config file and no environment variable to set in it.

1. Sign in to Patchwork with GitHub (**Connect GitHub**).
2. Choose **Add repository**. This opens the Patchwork GitHub App's install page, \`https://github.com/apps/<app-slug>/installations/new\`.
3. On GitHub, install the App and grant it access to the repository ("Only select repositories" limits it to the ones you pick). GitHub returns you to Patchwork, which lists the repository.
4. If the App's permissions change later, approve the pending request at \`https://github.com/settings/installations\`. Until then, anything that needs the new permission fails.

The App reads repository metadata and contents. Opening a pull request also needs Contents and Pull requests write access on the installation; without it, the pull request step fails with a permission error and nothing is written.

### Self-hosting

To run your own instance, create a GitHub App as described in \`docs/github-integration.md\` (callback URL \`<api-url>/auth/github/callback\`, setup URL \`<api-url>/github/install/callback\`, webhook inactive), then copy \`.env.example\` to \`.env\` and fill it in:

\`\`\`bash
DATABASE_URL=postgresql://patchwork:patchwork@localhost:5433/patchwork
GITHUB_APP_ID=<numeric app id>
GITHUB_APP_SLUG=<app slug, e.g. patchwork-dev>
GITHUB_CLIENT_ID=<client id>
GITHUB_CLIENT_SECRET=<client secret>
GITHUB_PRIVATE_KEY_BASE64=<output of: base64 -i app.private-key.pem | tr -d '\\n'>
WEB_APP_URL=http://localhost:3000
API_URL=http://localhost:3001
E2B_API_KEY=<required by the worker>
OPENAI_API_KEY=<optional, AI explanations only>
\`\`\`

Then, with Node 22.13 or later, pnpm 11.24 (\`corepack enable\`) and Docker:

\`\`\`bash
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
\`\`\`

The API and worker refuse to start with missing or invalid configuration.

## What happens after setup

- **Trigger.** A person starts each check: **Analyse** on a new repository, **Re-analyse** after that. There are no webhooks and no schedule, so a push does not start a check.
- **Analysis.** Patchwork downloads the default branch at its current commit and checks it against every tracked change. Each verdict belongs to that commit. Nothing in the repository is executed during analysis.
- **Fix.** On an \`AFFECTED\` change that has a fix, **Prepare fix** generates the diff and re-proves it with the compiler. If any part cannot be proven safe, no fix is produced, never a partial one.
- **Verification.** **Verify in sandbox** applies the diff to the analysed commit in an E2B sandbox, installs with the repository's own package manager and lockfile (network limited to the package registry), then runs the \`typecheck\` and \`test\` scripts from \`package.json\` with the network off. Only scripts with exactly those names run; a missing script is not run and not reported as passing. The sandbox receives no GitHub token or other credential.
- **Pull request.** **Create pull request** is available only after verification passes. Patchwork refuses if the default branch has moved since the analysis (re-analyse and re-verify first), and never changes \`package.json\`, lockfiles or \`.github/\`. It pushes a branch named \`patchwork/<fix-kind>/<id>\` with one commit authored by \`<app-slug>[bot]\`, and opens a pull request against the default branch titled \`Migrate <change title>\`. The body lists the affected files, the transformation, the static checks, each sandbox step with its exit code, the Node version and package manager, and Stripe's changelog link, ending with \`Patchwork-Change:\` and \`Patchwork-Patch:\` trailers.
- Patchwork opens at most one pull request per assessment. It never merges or deploys.

## Reviewing, merging and rolling back

1. Review the diff like any other pull request. The one fix that exists today rewrites \`invoice.subscription\` to \`invoice.parent?.subscription_details?.subscription ?? null\`; check that a \`null\` fallback suits the surrounding code.
2. Read the Verification section of the body and confirm both \`typecheck\` and \`test\` are listed. A missing one means the repository has no script of that name, so that check did not run; run it yourself.
3. Let the repository's own CI run on the branch, then merge through your normal process. The pull request does not upgrade the \`stripe\` package.
4. To decline, close the pull request and delete its \`patchwork/...\` branch. Patchwork does not open a second pull request for the same assessment.
5. To roll back after merging, use **Revert** on the merged pull request in GitHub, or \`git revert\` the merge commit. The change is a single commit touching only the listed source files.

## Limits

- GitHub only, Stripe only, TypeScript and \`stripe-node\` only.
- Four tracked Stripe changes, and only the first has an automatic fix:
  - Removes \`Invoice.subscription\` in favour of \`Invoice.parent.subscription_details.subscription\` (Basil, v18)
  - Replaces Upcoming Invoice API methods with the Create Preview Invoice API (Basil, v18)
  - Adds \`'expired'\` as a distinct Issuing Authorization status, previously reported as \`'reversed'\` (Basil, v18)
  - Removes the \`iterations\` parameter from Subscription Schedule phases (Clover, v19)
- One repository analysed at a time, started by hand.
- Analysis follows code within a module. Cases that need deeper data flow are \`UNCERTAIN\`.
- Verification runs install, \`typecheck\` and \`test\` only: no build or lint, Node 20 only, public registries only.
- No team access: an installation belongs to the Patchwork user who connected it first.

## Links

- Source and README: https://github.com/HamidZ11/patchwork
- Docs: https://github.com/HamidZ11/patchwork/tree/main/docs (GitHub App setup in \`docs/github-integration.md\`, verification in \`docs/verification.md\`)
- Contact: open an issue at https://github.com/HamidZ11/patchwork/issues
`;
