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
 * Run manually via `pnpm --filter @patchwork/worker build-e2b-template`
 * whenever this definition changes -- never invoked automatically by the
 * worker itself. Requires E2B_API_KEY in the environment.
 */
export function buildVerificationTemplate() {
  return Template().fromNodeImage('20').runCmd('apt-get update && apt-get install -y patch');
}

async function main() {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) throw new Error('E2B_API_KEY is required to build the verification template');

  await Template.build(buildVerificationTemplate(), {
    alias: SANDBOX_TEMPLATE,
    apiKey,
  });

  console.log(`Built E2B template "${SANDBOX_TEMPLATE}"`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
