import { describe, expect, it } from 'vitest';
import type { ExtractedFile } from '../../archive.js';
import { discoverManifests } from '../manifests.js';

function file(path: string, content: string): ExtractedFile {
  return { path, content };
}

describe('discoverManifests', () => {
  it('finds a direct stripe dependency in the root manifest', () => {
    const result = discoverManifests([
      file('package.json', JSON.stringify({ dependencies: { stripe: '^17.0.0' } })),
    ]);

    expect(result.manifestsDiscovered).toBe(1);
    expect(result.stripeDeclarations).toEqual([
      {
        workspacePath: '',
        manifestPath: 'package.json',
        dependencyField: 'dependencies',
        declaredRange: '^17.0.0',
      },
    ]);
    expect(result.workspaceConfigDiscovered).toBe('none');
  });

  it('produces no evidence when stripe is not declared anywhere', () => {
    const result = discoverManifests([
      file('package.json', JSON.stringify({ dependencies: { express: '^5.0.0' } })),
    ]);

    expect(result.stripeDeclarations).toEqual([]);
  });

  it('attributes stripe declarations to the correct workspace in a monorepo, not collapsed', () => {
    const result = discoverManifests([
      file('package.json', JSON.stringify({ workspaces: ['packages/*'] })),
      file(
        'packages/billing/package.json',
        JSON.stringify({ dependencies: { stripe: '^17.0.0' } }),
      ),
      file('packages/web/package.json', JSON.stringify({ dependencies: { express: '^5.0.0' } })),
    ]);

    expect(result.workspaceConfigDiscovered).toBe('npm_workspaces');
    expect(result.stripeDeclarations).toEqual([
      {
        workspacePath: 'packages/billing',
        manifestPath: 'packages/billing/package.json',
        dependencyField: 'dependencies',
        declaredRange: '^17.0.0',
      },
    ]);
  });

  it('detects multiple stripe contexts across workspaces without collapsing them', () => {
    const result = discoverManifests([
      file('packages/a/package.json', JSON.stringify({ dependencies: { stripe: '^17.0.0' } })),
      file('packages/b/package.json', JSON.stringify({ dependencies: { stripe: '^16.0.0' } })),
    ]);

    expect(result.stripeDeclarations).toHaveLength(2);
    expect(result.stripeDeclarations.map((d) => d.declaredRange).sort()).toEqual([
      '^16.0.0',
      '^17.0.0',
    ]);
  });

  it('detects pnpm-workspace.yaml as workspace config', () => {
    const result = discoverManifests([
      file('package.json', '{}'),
      file('pnpm-workspace.yaml', 'packages:\n  - packages/*\n'),
    ]);

    expect(result.workspaceConfigDiscovered).toBe('pnpm_workspaces');
  });

  it('records a malformed package.json as a parse failure and skips it, without crashing', () => {
    const result = discoverManifests([
      file('package.json', '{ this is not valid json'),
      file('packages/ok/package.json', JSON.stringify({ dependencies: { stripe: '^17.0.0' } })),
    ]);

    expect(result.parseFailures).toEqual(['package.json']);
    expect(result.stripeDeclarations).toEqual([
      {
        workspacePath: 'packages/ok',
        manifestPath: 'packages/ok/package.json',
        dependencyField: 'dependencies',
        declaredRange: '^17.0.0',
      },
    ]);
  });

  it('treats devDependencies and peerDependencies declarations distinctly', () => {
    const result = discoverManifests([
      file('package.json', JSON.stringify({ devDependencies: { stripe: '^17.0.0' } })),
    ]);

    expect(result.stripeDeclarations[0]?.dependencyField).toBe('devDependencies');
  });
});
