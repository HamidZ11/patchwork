import { describe, expect, it } from 'vitest';
import type { ExtractedFile } from '../../archive.js';
import type { StripeDeclaration } from '../manifests.js';
import { resolveStripeVersions } from '../lockfiles.js';

function file(path: string, content: string): ExtractedFile {
  return { path, content };
}

function declaration(overrides: Partial<StripeDeclaration> = {}): StripeDeclaration {
  return {
    workspacePath: '',
    manifestPath: 'package.json',
    dependencyField: 'dependencies',
    declaredRange: '^17.0.0',
    ...overrides,
  };
}

describe('resolveStripeVersions', () => {
  it('is DECLARED_ONLY when no lockfile is present', () => {
    const result = resolveStripeVersions([], [declaration()]);

    expect(result.installedSdks).toEqual([
      {
        packageName: 'stripe',
        workspacePath: '',
        manifestPath: 'package.json',
        dependencyField: 'dependencies',
        declaredRange: '^17.0.0',
        resolvedVersion: null,
        resolutionStatus: 'DECLARED_ONLY',
        evidenceSources: ['package.json'],
      },
    ]);
  });

  it('resolves an EXACT version from package-lock.json (hoisted root)', () => {
    const lockfile = JSON.stringify({
      packages: { '': {}, 'node_modules/stripe': { version: '17.4.0' } },
    });
    const result = resolveStripeVersions([file('package-lock.json', lockfile)], [declaration()]);

    expect(result.installedSdks[0]?.resolvedVersion).toBe('17.4.0');
    expect(result.installedSdks[0]?.resolutionStatus).toBe('EXACT');
    expect(result.installedSdks[0]?.evidenceSources).toEqual(['package.json', 'package-lock.json']);
    expect(result.lockfilesParsed).toEqual(['package-lock.json']);
  });

  it('prefers a workspace-specific override over the hoisted root in package-lock.json', () => {
    const lockfile = JSON.stringify({
      packages: {
        '': {},
        'node_modules/stripe': { version: '16.0.0' },
        'packages/billing/node_modules/stripe': { version: '17.4.0' },
      },
    });
    const result = resolveStripeVersions(
      [file('package-lock.json', lockfile)],
      [
        declaration({
          workspacePath: 'packages/billing',
          manifestPath: 'packages/billing/package.json',
        }),
      ],
    );

    expect(result.installedSdks[0]?.resolvedVersion).toBe('17.4.0');
  });

  it('resolves an EXACT version from pnpm-lock.yaml per workspace importer', () => {
    const lockfile = [
      'importers:',
      "  '.':",
      '    dependencies:',
      '      stripe:',
      '        specifier: ^17.0.0',
      '        version: 17.4.0',
      '  packages/billing:',
      '    dependencies:',
      '      stripe:',
      '        specifier: ^16.0.0',
      '        version: 16.2.0(peer@1.0.0)',
    ].join('\n');

    const result = resolveStripeVersions(
      [file('pnpm-lock.yaml', lockfile)],
      [
        declaration({ workspacePath: '' }),
        declaration({
          workspacePath: 'packages/billing',
          manifestPath: 'packages/billing/package.json',
          declaredRange: '^16.0.0',
        }),
      ],
    );

    expect(result.installedSdks).toHaveLength(2);
    const root = result.installedSdks.find((sdk) => sdk.workspacePath === '');
    const billing = result.installedSdks.find((sdk) => sdk.workspacePath === 'packages/billing');
    expect(root?.resolvedVersion).toBe('17.4.0');
    // peer-dependency suffix stripped
    expect(billing?.resolvedVersion).toBe('16.2.0');
  });

  it('reports CONFLICTING when npm and pnpm lockfiles disagree for the same workspace', () => {
    const npmLockfile = JSON.stringify({
      packages: { '': {}, 'node_modules/stripe': { version: '16.0.0' } },
    });
    const pnpmLockfile = [
      'importers:',
      "  '.':",
      '    dependencies:',
      '      stripe:',
      '        version: 17.4.0',
    ].join('\n');

    const result = resolveStripeVersions(
      [file('package-lock.json', npmLockfile), file('pnpm-lock.yaml', pnpmLockfile)],
      [declaration()],
    );

    expect(result.installedSdks[0]?.resolutionStatus).toBe('CONFLICTING');
    expect(result.installedSdks[0]?.resolvedVersion).toBeNull();
  });

  it('records yarn.lock as unsupported and falls back to DECLARED_ONLY', () => {
    const result = resolveStripeVersions(
      [file('yarn.lock', '# yarn lockfile v1\n')],
      [declaration()],
    );

    expect(result.lockfilesUnsupported).toEqual(['yarn.lock']);
    expect(result.installedSdks[0]?.resolutionStatus).toBe('DECLARED_ONLY');
  });

  it('reports UNKNOWN when the nearest lockfile exists but fails to parse', () => {
    const result = resolveStripeVersions(
      [file('package-lock.json', '{ not valid json')],
      [declaration()],
    );

    expect(result.parseFailures).toEqual(['package-lock.json']);
    expect(result.installedSdks[0]?.resolutionStatus).toBe('UNKNOWN');
  });

  it('does not collapse multiple installedSdks entries from different workspaces', () => {
    const result = resolveStripeVersions(
      [],
      [
        declaration({ workspacePath: 'packages/a', manifestPath: 'packages/a/package.json' }),
        declaration({ workspacePath: 'packages/b', manifestPath: 'packages/b/package.json' }),
      ],
    );

    expect(result.installedSdks).toHaveLength(2);
  });
});
