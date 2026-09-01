/**
 * Fixed Patchwork policy for v1 sandbox verification -- every value here
 * is a deliberate, narrow default, not a placeholder. Widening any of
 * these (recognizing more scripts, allowing more registries, raising
 * timeouts) is a policy change that should be made here, deliberately,
 * not inferred from a repository or a caller.
 */

/** No engines.node / .nvmrc / .node-version / volta declaration at all -> this is what verification actually runs under. Recorded as source: 'patchwork_default', never implied to be the repository's own declared runtime. */
export const PATCHWORK_DEFAULT_NODE_MAJOR = 20;
export const PATCHWORK_DEFAULT_NODE_VERSION = '20';

/** A repository's engines.node/.nvmrc/.node-version/volta declaration must include this major version, or verification REFUSEs rather than silently substituting a different runtime. */
export const PATCHWORK_SUPPORTED_NODE_MAJOR = 20;

/**
 * Only the default registry per package manager is allowlisted for the
 * install phase -- deliberately no allow-all fallback (approved
 * correction: a malicious dependency/lifecycle script could otherwise
 * exfiltrate repository contents, including committed credentials,
 * during install). Any evidence of a custom registry configuration
 * REFUSES rather than silently widening access -- see manifest.ts's
 * `hasCustomRegistryConfig`.
 */
export const INSTALL_ALLOWED_HOSTS: Record<
  'npm' | 'pnpm' | 'yarn-classic' | 'yarn-berry',
  string[]
> = {
  npm: ['registry.npmjs.org'],
  pnpm: ['registry.npmjs.org'],
  'yarn-classic': ['registry.yarnpkg.com'],
  'yarn-berry': ['registry.yarnpkg.com'],
};

/**
 * Only these exact script names are ever recognized -- no synonyms
 * (e.g. no "test:unit") until a concrete repository shows a real need.
 * install is always attempted first via the package manager's own
 * lockfile-respecting command (never a package.json script); typecheck
 * and test are only run if the repository defines that exact script.
 */
export const RECOGNIZED_SCRIPTS: Record<'typecheck' | 'test', string> = {
  typecheck: 'typecheck',
  test: 'test',
};

export const TIMEOUT_POLICY = {
  perCommandMs: 5 * 60 * 1000, // 5 minutes
  totalMs: 15 * 60 * 1000, // 15 minutes
  sandboxLifetimeMs: 20 * 60 * 1000, // provider-enforced backstop, above totalMs
};

export const OUTPUT_CAPS = {
  perStreamBytes: 8 * 1024, // 8 KiB
  perRunTotalBytes: 32 * 1024, // 32 KiB
};

export const LEASE_DURATION_MS = 20 * 60 * 1000; // 20 minutes -- must exceed sandboxLifetimeMs + margin

/** Fixed, Patchwork-owned E2B template -- see verification/e2b-template.ts. Never a customer-influenced or ad hoc image. */
export const SANDBOX_TEMPLATE = 'patchwork-verification-node20';
