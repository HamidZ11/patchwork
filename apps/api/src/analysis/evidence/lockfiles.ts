import { parse as parseYaml } from 'yaml';
import type { ExtractedFile } from '../archive.js';
import type { StripeDeclaration } from './manifests.js';
import type { InstalledSdkEvidence } from './types.js';

interface NpmLockfile {
  path: string;
  packages: Record<string, { version?: string }>;
}

interface PnpmLockfile {
  path: string;
  importers: Record<
    string,
    {
      dependencies?: Record<string, { version?: string }>;
      devDependencies?: Record<string, { version?: string }>;
    }
  >;
}

export interface LockfileResolutionResult {
  installedSdks: InstalledSdkEvidence[];
  lockfilesDiscovered: string[];
  lockfilesParsed: string[];
  lockfilesUnsupported: string[];
  parseFailures: string[];
}

function directoryOf(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
}

/** The path whose directory is the longest (closest) ancestor of workspacePath. */
function findNearestPath(workspacePath: string, paths: string[]): string | undefined {
  let best: string | undefined;
  let bestLength = -1;
  for (const path of paths) {
    const dir = directoryOf(path);
    const isAncestor = dir === '' || workspacePath === dir || workspacePath.startsWith(`${dir}/`);
    if (isAncestor && dir.length > bestLength) {
      best = path;
      bestLength = dir.length;
    }
  }
  return best;
}

/** Strips a pnpm peer-dependency suffix like "17.4.0(some-peer@1.0.0)". */
function sanitizePnpmVersion(version: string): string {
  return version.split('(')[0] ?? version;
}

function resolveFromNpmLockfile(workspacePath: string, lockfile: NpmLockfile): string | null {
  const nestedKey =
    workspacePath === '' ? 'node_modules/stripe' : `${workspacePath}/node_modules/stripe`;
  const nested = lockfile.packages[nestedKey]?.version;
  if (nested) return nested;
  return lockfile.packages['node_modules/stripe']?.version ?? null;
}

function resolveFromPnpmLockfile(workspacePath: string, lockfile: PnpmLockfile): string | null {
  const importerKey = workspacePath === '' ? '.' : workspacePath;
  const importer = lockfile.importers[importerKey];
  if (!importer) return null;
  const raw = importer.dependencies?.stripe?.version ?? importer.devDependencies?.stripe?.version;
  return raw ? sanitizePnpmVersion(raw) : null;
}

/**
 * Resolves each declared `stripe` dependency against the nearest
 * package-lock.json / pnpm-lock.yaml. Both formats key entries by a
 * repo-root-relative path regardless of where the lockfile itself sits, so
 * once the nearest lockfile is chosen (longest matching ancestor
 * directory -- there is typically exactly one, at the repo root), the
 * declaration's own workspacePath is used directly as the lookup key.
 * yarn.lock is recognized but never parsed (bespoke grammar, not
 * JSON/YAML) -- affected declarations fall back to DECLARED_ONLY.
 */
export function resolveStripeVersions(
  files: ExtractedFile[],
  stripeDeclarations: StripeDeclaration[],
): LockfileResolutionResult {
  const npmLockfileFiles = files.filter(
    (file) => file.path.endsWith('/package-lock.json') || file.path === 'package-lock.json',
  );
  const pnpmLockfileFiles = files.filter(
    (file) => file.path.endsWith('/pnpm-lock.yaml') || file.path === 'pnpm-lock.yaml',
  );
  const yarnLockfileFiles = files.filter(
    (file) => file.path.endsWith('/yarn.lock') || file.path === 'yarn.lock',
  );

  const lockfilesDiscovered = [
    ...npmLockfileFiles.map((f) => f.path),
    ...pnpmLockfileFiles.map((f) => f.path),
    ...yarnLockfileFiles.map((f) => f.path),
  ];
  const lockfilesUnsupported = yarnLockfileFiles.map((f) => f.path);
  const parseFailures: string[] = [];
  const lockfilesParsed: string[] = [];

  const npmLockfilesByPath = new Map<string, NpmLockfile>();
  for (const file of npmLockfileFiles) {
    try {
      const parsed = JSON.parse(file.content) as {
        packages?: Record<string, { version?: string }>;
      };
      npmLockfilesByPath.set(file.path, { path: file.path, packages: parsed.packages ?? {} });
      lockfilesParsed.push(file.path);
    } catch {
      parseFailures.push(file.path);
    }
  }

  const pnpmLockfilesByPath = new Map<string, PnpmLockfile>();
  for (const file of pnpmLockfileFiles) {
    try {
      const parsed = parseYaml(file.content) as { importers?: PnpmLockfile['importers'] };
      pnpmLockfilesByPath.set(file.path, { path: file.path, importers: parsed.importers ?? {} });
      lockfilesParsed.push(file.path);
    } catch {
      parseFailures.push(file.path);
    }
  }

  const npmLockfilePaths = npmLockfileFiles.map((f) => f.path);
  const pnpmLockfilePaths = pnpmLockfileFiles.map((f) => f.path);

  const installedSdks: InstalledSdkEvidence[] = stripeDeclarations.map((declaration) => {
    const nearestNpmPath = findNearestPath(declaration.workspacePath, npmLockfilePaths);
    const nearestPnpmPath = findNearestPath(declaration.workspacePath, pnpmLockfilePaths);
    const nearestNpm = nearestNpmPath ? npmLockfilesByPath.get(nearestNpmPath) : undefined;
    const nearestPnpm = nearestPnpmPath ? pnpmLockfilesByPath.get(nearestPnpmPath) : undefined;

    const npmResolved = nearestNpm
      ? resolveFromNpmLockfile(declaration.workspacePath, nearestNpm)
      : null;
    const pnpmResolved = nearestPnpm
      ? resolveFromPnpmLockfile(declaration.workspacePath, nearestPnpm)
      : null;

    const evidenceSources = [declaration.manifestPath];
    if (nearestNpm && npmResolved) evidenceSources.push(nearestNpm.path);
    if (nearestPnpm && pnpmResolved) evidenceSources.push(nearestPnpm.path);

    if (npmResolved && pnpmResolved && npmResolved !== pnpmResolved) {
      return {
        packageName: 'stripe',
        workspacePath: declaration.workspacePath,
        manifestPath: declaration.manifestPath,
        dependencyField: declaration.dependencyField,
        declaredRange: declaration.declaredRange,
        resolvedVersion: null,
        resolutionStatus: 'CONFLICTING',
        evidenceSources,
      };
    }

    const resolvedVersion = npmResolved ?? pnpmResolved;
    if (resolvedVersion) {
      return {
        packageName: 'stripe',
        workspacePath: declaration.workspacePath,
        manifestPath: declaration.manifestPath,
        dependencyField: declaration.dependencyField,
        declaredRange: declaration.declaredRange,
        resolvedVersion,
        resolutionStatus: 'EXACT',
        evidenceSources,
      };
    }

    // No resolution found. If the nearest lockfile covering this workspace
    // exists but failed to parse, that's genuine ambiguity (UNKNOWN), not
    // just an absent lockfile (DECLARED_ONLY).
    const onlyUnparseableLockfile =
      (nearestNpmPath !== undefined && !nearestNpm) ||
      (nearestPnpmPath !== undefined && !nearestPnpm);

    return {
      packageName: 'stripe',
      workspacePath: declaration.workspacePath,
      manifestPath: declaration.manifestPath,
      dependencyField: declaration.dependencyField,
      declaredRange: declaration.declaredRange,
      resolvedVersion: null,
      resolutionStatus: onlyUnparseableLockfile ? 'UNKNOWN' : 'DECLARED_ONLY',
      evidenceSources: [declaration.manifestPath],
    };
  });

  return {
    installedSdks,
    lockfilesDiscovered,
    lockfilesParsed,
    lockfilesUnsupported,
    parseFailures,
  };
}
