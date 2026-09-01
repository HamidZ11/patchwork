import { parse as parseYaml } from 'yaml';
import semver from 'semver';
import type { VerificationExtractedFile } from '@patchwork/archive';
import {
  INSTALL_ALLOWED_HOSTS,
  PATCHWORK_DEFAULT_NODE_VERSION,
  PATCHWORK_SUPPORTED_NODE_MAJOR,
  RECOGNIZED_SCRIPTS,
  TIMEOUT_POLICY,
} from './policy.js';
import type { PackageManagerName, VerificationManifest } from './types.js';

export type ManifestResult =
  { kind: 'ok'; manifest: VerificationManifest } | { kind: 'refused'; reason: string };

function decode(file: VerificationExtractedFile): string {
  return Buffer.from(file.contentBase64, 'base64').toString('utf-8');
}

function findRoot(
  files: VerificationExtractedFile[],
  path: string,
): VerificationExtractedFile | undefined {
  return files.find((f) => f.path === path);
}

interface PackageManagerDetection {
  kind: 'ok';
  name: PackageManagerName;
  version: string | null;
  yarnBerry: boolean;
}
type PackageManagerDetectionResult = PackageManagerDetection | { kind: 'refused'; reason: string };

/**
 * Priority, mirroring the "don't guess on conflicting evidence" precedent
 * already established for Stripe-version resolution
 * (analysis/evidence/lockfiles.ts's CONFLICTING status): the
 * `packageManager` field (Corepack-pinned) is authoritative when present;
 * otherwise exactly one recognized lockfile; any disagreement or absence
 * of usable evidence REFUSEs rather than silently picking one.
 */
function detectPackageManager(files: VerificationExtractedFile[]): PackageManagerDetectionResult {
  const packageJsonFile = findRoot(files, 'package.json');
  let declared: { name: PackageManagerName; version: string } | null = null;

  if (packageJsonFile) {
    try {
      const pkg = JSON.parse(decode(packageJsonFile)) as { packageManager?: string };
      if (pkg.packageManager) {
        const match = /^(npm|pnpm|yarn)@([\w.+-]+)$/.exec(pkg.packageManager);
        if (match) {
          declared = { name: match[1] as PackageManagerName, version: match[2]! };
        }
      }
    } catch {
      // package.json is unparseable -- handled by node-version resolution
      // failing too; here we simply have no packageManager evidence.
    }
  }

  const hasNpmLock = Boolean(findRoot(files, 'package-lock.json'));
  const hasPnpmLock = Boolean(findRoot(files, 'pnpm-lock.yaml'));
  const hasYarnLock = Boolean(findRoot(files, 'yarn.lock'));
  const lockCount = [hasNpmLock, hasPnpmLock, hasYarnLock].filter(Boolean).length;

  const yarnBerry = Boolean(findRoot(files, '.yarnrc.yml'));

  if (declared) {
    const lockPresentFor: Record<PackageManagerName, boolean> = {
      npm: hasNpmLock,
      pnpm: hasPnpmLock,
      yarn: hasYarnLock,
    };
    if (!lockPresentFor[declared.name]) {
      return {
        kind: 'refused',
        reason: `package.json declares packageManager "${declared.name}@${declared.version}", but no matching lockfile was found -- refusing rather than guessing`,
      };
    }
    return {
      kind: 'ok',
      name: declared.name,
      version: declared.version,
      yarnBerry:
        declared.name === 'yarn'
          ? semver.major(semver.coerce(declared.version) ?? '1.0.0') >= 2
          : yarnBerry,
    };
  }

  if (lockCount === 0) {
    return {
      kind: 'refused',
      reason: 'no lockfile found -- cannot determine a deterministic install command',
    };
  }
  if (lockCount > 1) {
    return {
      kind: 'refused',
      reason:
        'multiple lockfiles found with no packageManager field to disambiguate -- refusing rather than guessing',
    };
  }

  if (hasNpmLock) return { kind: 'ok', name: 'npm', version: null, yarnBerry: false };
  if (hasPnpmLock) return { kind: 'ok', name: 'pnpm', version: null, yarnBerry: false };
  return { kind: 'ok', name: 'yarn', version: null, yarnBerry };
}

/**
 * Any evidence of a custom/private registry configuration REFUSEs --
 * the v1 install-network allowlist only covers each package manager's
 * public default registry (see policy.ts's INSTALL_ALLOWED_HOSTS), and
 * silently widening network access for a repository that needs more
 * would defeat the whole point of the allowlist. Bounded, deterministic
 * evidence check: presence of a registry-override key in the relevant
 * config file, not an attempt to resolve what it actually points to.
 */
function hasCustomRegistryConfig(files: VerificationExtractedFile[]): string | null {
  const npmrc = findRoot(files, '.npmrc');
  if (npmrc && /(^|\n)\s*registry\s*=/.test(decode(npmrc)))
    return '.npmrc declares a custom registry';

  const yarnrc = findRoot(files, '.yarnrc');
  if (yarnrc && /(^|\n)\s*registry\s+/.test(decode(yarnrc)))
    return '.yarnrc declares a custom registry';

  const yarnrcYml = findRoot(files, '.yarnrc.yml');
  if (yarnrcYml) {
    try {
      const parsed = parseYaml(decode(yarnrcYml)) as { npmRegistryServer?: string } | null;
      if (parsed?.npmRegistryServer) return '.yarnrc.yml declares a custom npmRegistryServer';
    } catch {
      return '.yarnrc.yml could not be parsed -- refusing rather than assuming no custom registry';
    }
  }

  return null;
}

type NodeVersionResult =
  | { kind: 'ok'; version: string; source: 'repository' | 'patchwork_default' }
  | { kind: 'refused'; reason: string };

/**
 * Priority: engines.node (a semver range, checked for intersection with
 * Patchwork's supported major) -> .nvmrc -> .node-version -> volta.node
 * (each an exact/partial version, checked by major number) -> Patchwork
 * default (only when the repository declares nothing at all). An
 * explicit declaration Patchwork's sandbox doesn't support REFUSEs --
 * never silently substituted, since behavior can genuinely differ across
 * Node majors.
 */
function resolveNodeVersion(files: VerificationExtractedFile[]): NodeVersionResult {
  const packageJsonFile = findRoot(files, 'package.json');
  if (packageJsonFile) {
    try {
      const pkg = JSON.parse(decode(packageJsonFile)) as {
        engines?: { node?: string };
        volta?: { node?: string };
      };
      const range = pkg.engines?.node;
      if (range) {
        const supportedRange = `${PATCHWORK_SUPPORTED_NODE_MAJOR}.x`;
        if (!semver.validRange(range)) {
          return {
            kind: 'refused',
            reason: `package.json engines.node ("${range}") is not a valid semver range`,
          };
        }
        if (!semver.intersects(range, supportedRange)) {
          return {
            kind: 'refused',
            reason: `repository requires Node "${range}", which does not include Patchwork's supported Node ${PATCHWORK_SUPPORTED_NODE_MAJOR}`,
          };
        }
        return { kind: 'ok', version: range, source: 'repository' };
      }

      const voltaNode = pkg.volta?.node;
      if (voltaNode) {
        const major = semver.major(semver.coerce(voltaNode) ?? '');
        if (Number.isNaN(major)) {
          return {
            kind: 'refused',
            reason: `package.json volta.node ("${voltaNode}") could not be parsed`,
          };
        }
        if (major !== PATCHWORK_SUPPORTED_NODE_MAJOR) {
          return {
            kind: 'refused',
            reason: `repository pins Node ${voltaNode} via volta, which does not match Patchwork's supported Node ${PATCHWORK_SUPPORTED_NODE_MAJOR}`,
          };
        }
        return { kind: 'ok', version: voltaNode, source: 'repository' };
      }
    } catch {
      return { kind: 'refused', reason: 'package.json could not be parsed' };
    }
  }

  for (const path of ['.nvmrc', '.node-version']) {
    const file = findRoot(files, path);
    if (!file) continue;
    const raw = decode(file).trim();
    const coerced = semver.coerce(raw);
    if (!coerced) continue; // e.g. "lts/*" -- not a usable declaration, fall through
    if (coerced.major !== PATCHWORK_SUPPORTED_NODE_MAJOR) {
      return {
        kind: 'refused',
        reason: `${path} declares Node "${raw}", which does not match Patchwork's supported Node ${PATCHWORK_SUPPORTED_NODE_MAJOR}`,
      };
    }
    return { kind: 'ok', version: raw, source: 'repository' };
  }

  return { kind: 'ok', version: PATCHWORK_DEFAULT_NODE_VERSION, source: 'patchwork_default' };
}

function scriptNames(files: VerificationExtractedFile[]): Set<string> {
  const packageJsonFile = findRoot(files, 'package.json');
  if (!packageJsonFile) return new Set();
  try {
    const pkg = JSON.parse(decode(packageJsonFile)) as { scripts?: Record<string, string> };
    return new Set(Object.keys(pkg.scripts ?? {}));
  } catch {
    return new Set();
  }
}

function installCommandFor(
  pm: PackageManagerName,
  yarnBerry: boolean,
): { executable: string; args: string[] } {
  if (pm === 'npm') return { executable: 'npm', args: ['ci'] };
  if (pm === 'pnpm') return { executable: 'pnpm', args: ['install', '--frozen-lockfile'] };
  return yarnBerry
    ? { executable: 'yarn', args: ['install', '--immutable'] }
    : { executable: 'yarn', args: ['install', '--frozen-lockfile'] };
}

function runCommandFor(
  pm: PackageManagerName,
  scriptName: string,
): { executable: string; args: string[] } {
  if (pm === 'npm') return { executable: 'npm', args: ['run', scriptName] };
  if (pm === 'pnpm') return { executable: 'pnpm', args: ['run', scriptName] };
  return { executable: 'yarn', args: ['run', scriptName] };
}

function allowedInstallHosts(pm: PackageManagerName, yarnBerry: boolean): string[] {
  if (pm === 'npm') return INSTALL_ALLOWED_HOSTS.npm;
  if (pm === 'pnpm') return INSTALL_ALLOWED_HOSTS.pnpm;
  return yarnBerry ? INSTALL_ALLOWED_HOSTS['yarn-berry'] : INSTALL_ALLOWED_HOSTS['yarn-classic'];
}

export function deriveManifest(params: {
  files: VerificationExtractedFile[];
  patchAttemptId: string;
  diffSha256: string;
  workingDirectory: string;
}): ManifestResult {
  const pmResult = detectPackageManager(params.files);
  if (pmResult.kind === 'refused') return pmResult;

  const customRegistry = hasCustomRegistryConfig(params.files);
  if (customRegistry) {
    return {
      kind: 'refused',
      reason: `${customRegistry} -- unsupported for v1 (no allow-all install-network fallback; only default public registries are allowlisted)`,
    };
  }

  const nodeResult = resolveNodeVersion(params.files);
  if (nodeResult.kind === 'refused') return nodeResult;

  const scripts = scriptNames(params.files);
  const commands: VerificationManifest['commands'] = [];
  if (scripts.has(RECOGNIZED_SCRIPTS.typecheck)) {
    commands.push({
      kind: 'typecheck',
      ...runCommandFor(pmResult.name, RECOGNIZED_SCRIPTS.typecheck),
      timeoutMs: TIMEOUT_POLICY.perCommandMs,
    });
  }
  if (scripts.has(RECOGNIZED_SCRIPTS.test)) {
    commands.push({
      kind: 'test',
      ...runCommandFor(pmResult.name, RECOGNIZED_SCRIPTS.test),
      timeoutMs: TIMEOUT_POLICY.perCommandMs,
    });
  }

  return {
    kind: 'ok',
    manifest: {
      version: 1,
      workingDirectory: params.workingDirectory,
      runtime: {
        node: { version: nodeResult.version, source: nodeResult.source },
        packageManager: { name: pmResult.name, version: pmResult.version },
      },
      patch: { patchAttemptId: params.patchAttemptId, diffSha256: params.diffSha256 },
      installCommand: installCommandFor(pmResult.name, pmResult.yarnBerry),
      commands,
      timeoutPolicy: { perCommandMs: TIMEOUT_POLICY.perCommandMs, totalMs: TIMEOUT_POLICY.totalMs },
      networkPolicy: {
        install: {
          mode: 'allowlist',
          allowedHosts: allowedInstallHosts(pmResult.name, pmResult.yarnBerry),
        },
        verify: { mode: 'deny-all' },
      },
    },
  };
}
