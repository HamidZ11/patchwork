import type { ExtractedFile } from '../archive.js';
import type { DependencyField, WorkspaceConfigDiscovered } from './types.js';

const DEPENDENCY_FIELDS: DependencyField[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
];

export interface StripeDeclaration {
  workspacePath: string;
  manifestPath: string;
  dependencyField: DependencyField;
  declaredRange: string;
}

export interface ManifestDiscoveryResult {
  manifestsDiscovered: number;
  workspaceConfigDiscovered: WorkspaceConfigDiscovered;
  stripeDeclarations: StripeDeclaration[];
  parseFailures: string[];
}

/** Directory containing manifestPath, '' for a root-level package.json. */
export function workspacePathOf(manifestPath: string): string {
  const index = manifestPath.lastIndexOf('/');
  return index === -1 ? '' : manifestPath.slice(0, index);
}

/** Every workspace directory (one containing a package.json) found in an extracted file set. */
export function discoverWorkspaceDirs(files: ExtractedFile[]): string[] {
  const dirs = files
    .filter((file) => file.path === 'package.json' || file.path.endsWith('/package.json'))
    .map((file) => workspacePathOf(file.path));
  return dirs.length === 0 ? [''] : dirs;
}

/**
 * The workspace directory that is the closest ancestor of filePath -- for
 * attributing evidence found in an arbitrary source file (not a manifest
 * itself) to the correct workspace. Unlike workspacePathOf (which only
 * strips a manifest's own last path segment), this walks up from a
 * nested source file to whichever known workspace directory actually
 * contains it.
 */
export function nearestWorkspaceFor(filePath: string, workspaceDirs: string[]): string {
  let best = '';
  let bestLength = -1;
  for (const dir of workspaceDirs) {
    const isAncestor = dir === '' || filePath.startsWith(`${dir}/`);
    if (isAncestor && dir.length > bestLength) {
      best = dir;
      bestLength = dir.length;
    }
  }
  return best;
}

/**
 * Every package.json found during archive extraction IS the workspace
 * list -- no glob-matching of a `workspaces` field or pnpm-workspace.yaml
 * package globs. We don't need to know which nested manifests are
 * *formally* workspace members to find where `stripe` is declared; each
 * manifest's directory is simply its evidence-ownership identifier.
 * `workspaceConfigDiscovered` is informational coverage metadata only.
 */
export function discoverManifests(files: ExtractedFile[]): ManifestDiscoveryResult {
  const manifestFiles = files.filter(
    (file) => file.path === 'package.json' || file.path.endsWith('/package.json'),
  );
  const hasPnpmWorkspaceFile = files.some((file) => file.path === 'pnpm-workspace.yaml');

  const stripeDeclarations: StripeDeclaration[] = [];
  const parseFailures: string[] = [];
  let workspaceConfigDiscovered: WorkspaceConfigDiscovered = hasPnpmWorkspaceFile
    ? 'pnpm_workspaces'
    : 'none';

  for (const file of manifestFiles) {
    let manifest: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(file.content);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('package.json is not an object');
      }
      manifest = parsed as Record<string, unknown>;
    } catch {
      parseFailures.push(file.path);
      continue;
    }

    if (workspaceConfigDiscovered === 'none') {
      const workspacesField = manifest.workspaces;
      const hasWorkspacesField =
        Array.isArray(workspacesField) ||
        (typeof workspacesField === 'object' && workspacesField !== null);
      if (hasWorkspacesField) workspaceConfigDiscovered = 'npm_workspaces';
    }

    const workspacePath = workspacePathOf(file.path);
    for (const field of DEPENDENCY_FIELDS) {
      const deps = manifest[field];
      if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) continue;

      const range = (deps as Record<string, unknown>).stripe;
      if (typeof range === 'string') {
        stripeDeclarations.push({
          workspacePath,
          manifestPath: file.path,
          dependencyField: field,
          declaredRange: range,
        });
      }
    }
  }

  return {
    manifestsDiscovered: manifestFiles.length,
    workspaceConfigDiscovered,
    stripeDeclarations,
    parseFailures,
  };
}
