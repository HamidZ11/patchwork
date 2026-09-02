import { Template } from 'e2b';
import { SANDBOX_TEMPLATE } from './policy.js';

/**
 * One-time setup, not part of the request-time flow: builds (or
 * rebuilds) the fixed, Patchwork-owned E2B template every verification
 * run boots from -- a declarative, versioned definition, not an ad hoc
 * or customer-influenced image. Pinned to Node 20 (matching
 * PATCHWORK_SUPPORTED_NODE_MAJOR in policy.ts) plus the POSIX `patch`
 * utility, which the base Node image does not include by default and
 * verification/patch-apply.ts depends on.
 *
 * `{ user: 'root' }` on this one build step only: confirmed live against
 * a real build (2026-09) that E2B's `node:20` base image sets a
 * non-root default user, so `apt-get` fails with "Permission denied"
 * without it -- this is exclusively a template-*build-time* privilege
 * (installing an OS package while constructing the fixed image), never
 * a runtime/security policy change. The sandbox's runtime default user
 * for actual verification work (install/typecheck/test) is unaffected --
 * still whatever the base image's own DEFAULT USER is.
 *
 * Run manually via `pnpm --filter @patchwork/worker build-e2b-template`
 * whenever this definition changes -- never invoked automatically by the
 * worker itself. Requires E2B_API_KEY in the environment.
 */
export function buildVerificationTemplate() {
  return Template()
    .fromNodeImage('20')
    .runCmd('apt-get update && apt-get install -y patch', { user: 'root' });
}

async function main() {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) throw new Error('E2B_API_KEY is required to build the verification template');

  await Template.build(buildVerificationTemplate(), {
    alias: SANDBOX_TEMPLATE,
    apiKey,
    // Surfaces the build service's own step-by-step log (which build
    // step is running, its stdout/stderr) rather than only a final
    // BuildError -- this is what actually revealed the non-root-user
    // permission failure above; without it, only a bare "exit status
    // 100" is visible.
    onBuildLogs: (entry) => {
      console.log(`[${entry.level}] ${entry.message}`);
    },
  });

  console.log(`Built E2B template "${SANDBOX_TEMPLATE}"`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
