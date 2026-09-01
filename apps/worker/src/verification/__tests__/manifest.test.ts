import { describe, expect, it } from 'vitest';
import type { VerificationExtractedFile } from '@patchwork/archive';
import { deriveManifest } from '../manifest.js';

function file(path: string, content: string): VerificationExtractedFile {
  return { path, contentBase64: Buffer.from(content, 'utf-8').toString('base64') };
}

function baseParams(files: VerificationExtractedFile[]) {
  return { files, patchAttemptId: 'pa-1', diffSha256: 'abc', workingDirectory: '' };
}

const PKG_NO_ENGINES = JSON.stringify({
  name: 'demo',
  scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' },
});

describe('deriveManifest', () => {
  // --- package manager detection ---------------------------------------

  it('detects npm from package-lock.json with no packageManager field', () => {
    const result = deriveManifest(
      baseParams([file('package.json', PKG_NO_ENGINES), file('package-lock.json', '{}')]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.runtime.packageManager).toEqual({ name: 'npm', version: null });
    expect(result.manifest.installCommand).toEqual({ executable: 'npm', args: ['ci'] });
  });

  it('detects pnpm from pnpm-lock.yaml', () => {
    const result = deriveManifest(
      baseParams([file('package.json', PKG_NO_ENGINES), file('pnpm-lock.yaml', '{}')]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.runtime.packageManager.name).toBe('pnpm');
    expect(result.manifest.installCommand).toEqual({
      executable: 'pnpm',
      args: ['install', '--frozen-lockfile'],
    });
  });

  it('detects yarn classic from yarn.lock with no .yarnrc.yml', () => {
    const result = deriveManifest(
      baseParams([file('package.json', PKG_NO_ENGINES), file('yarn.lock', '')]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.installCommand).toEqual({
      executable: 'yarn',
      args: ['install', '--frozen-lockfile'],
    });
  });

  it('detects yarn berry from yarn.lock + .yarnrc.yml, using --immutable not --frozen-lockfile', () => {
    const result = deriveManifest(
      baseParams([
        file('package.json', PKG_NO_ENGINES),
        file('yarn.lock', ''),
        file('.yarnrc.yml', 'nodeLinker: node-modules\n'),
      ]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.installCommand).toEqual({
      executable: 'yarn',
      args: ['install', '--immutable'],
    });
  });

  it('uses the packageManager field when present and its lockfile exists', () => {
    const pkg = JSON.stringify({ packageManager: 'pnpm@8.10.0', scripts: {} });
    const result = deriveManifest(
      baseParams([file('package.json', pkg), file('pnpm-lock.yaml', '{}')]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.runtime.packageManager).toEqual({ name: 'pnpm', version: '8.10.0' });
  });

  it('REFUSES when packageManager field disagrees with the only lockfile present', () => {
    const pkg = JSON.stringify({ packageManager: 'pnpm@8.10.0', scripts: {} });
    const result = deriveManifest(
      baseParams([file('package.json', pkg), file('package-lock.json', '{}')]),
    );
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/packageManager.*pnpm.*no matching lockfile/i);
  });

  it('REFUSES when multiple lockfiles are present with no packageManager field to disambiguate', () => {
    const result = deriveManifest(
      baseParams([
        file('package.json', PKG_NO_ENGINES),
        file('package-lock.json', '{}'),
        file('pnpm-lock.yaml', '{}'),
      ]),
    );
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/multiple lockfiles/i);
  });

  it('REFUSES when no lockfile is present at all', () => {
    const result = deriveManifest(baseParams([file('package.json', PKG_NO_ENGINES)]));
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/no lockfile/i);
  });

  it('REFUSES on a custom .npmrc registry (no allow-all fallback)', () => {
    const result = deriveManifest(
      baseParams([
        file('package.json', PKG_NO_ENGINES),
        file('package-lock.json', '{}'),
        file('.npmrc', 'registry=https://my-private-registry.example.com\n'),
      ]),
    );
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/custom registry/i);
  });

  it('REFUSES on a custom .yarnrc.yml npmRegistryServer', () => {
    const result = deriveManifest(
      baseParams([
        file('package.json', PKG_NO_ENGINES),
        file('yarn.lock', ''),
        file('.yarnrc.yml', 'npmRegistryServer: "https://my-private-registry.example.com"\n'),
      ]),
    );
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/custom npmRegistryServer/i);
  });

  // --- Node version resolution -------------------------------------------

  it('falls back to the Patchwork default when nothing is declared', () => {
    const result = deriveManifest(
      baseParams([file('package.json', PKG_NO_ENGINES), file('package-lock.json', '{}')]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.runtime.node).toEqual({ version: '20', source: 'patchwork_default' });
  });

  it('uses engines.node when it intersects the supported major', () => {
    const pkg = JSON.stringify({ engines: { node: '>=18' }, scripts: {} });
    const result = deriveManifest(
      baseParams([file('package.json', pkg), file('package-lock.json', '{}')]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.runtime.node).toEqual({ version: '>=18', source: 'repository' });
  });

  it('REFUSES when engines.node does not include the supported major', () => {
    const pkg = JSON.stringify({ engines: { node: '18.x' }, scripts: {} });
    const result = deriveManifest(
      baseParams([file('package.json', pkg), file('package-lock.json', '{}')]),
    );
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/does not include Patchwork's supported Node/i);
  });

  it('uses .nvmrc when engines.node is absent', () => {
    const result = deriveManifest(
      baseParams([
        file('package.json', PKG_NO_ENGINES),
        file('package-lock.json', '{}'),
        file('.nvmrc', '20.11.0\n'),
      ]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.runtime.node).toEqual({ version: '20.11.0', source: 'repository' });
  });

  it('REFUSES when .nvmrc declares an unsupported major', () => {
    const result = deriveManifest(
      baseParams([
        file('package.json', PKG_NO_ENGINES),
        file('package-lock.json', '{}'),
        file('.nvmrc', '18\n'),
      ]),
    );
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/\.nvmrc declares Node "18"/i);
  });

  it('falls through an unparseable .nvmrc value (e.g. "lts/*") to the Patchwork default', () => {
    const result = deriveManifest(
      baseParams([
        file('package.json', PKG_NO_ENGINES),
        file('package-lock.json', '{}'),
        file('.nvmrc', 'lts/*\n'),
      ]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.runtime.node.source).toBe('patchwork_default');
  });

  // --- script discovery ---------------------------------------------------

  it('only recognizes the exact "typecheck" and "test" script names', () => {
    const pkg = JSON.stringify({
      scripts: { 'test:unit': 'vitest', build: 'tsc', lint: 'eslint .' },
    });
    const result = deriveManifest(
      baseParams([file('package.json', pkg), file('package-lock.json', '{}')]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.commands).toEqual([]);
  });

  it('includes typecheck and test commands when both scripts are present, in that order', () => {
    const result = deriveManifest(
      baseParams([file('package.json', PKG_NO_ENGINES), file('package-lock.json', '{}')]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.commands.map((c) => c.kind)).toEqual(['typecheck', 'test']);
    expect(result.manifest.commands[0]).toMatchObject({
      executable: 'npm',
      args: ['run', 'typecheck'],
    });
  });

  it('never includes build or lint commands (not part of the v1 supported set)', () => {
    const pkg = JSON.stringify({
      scripts: { typecheck: 'tsc', test: 'vitest', build: 'tsc -b', lint: 'eslint .' },
    });
    const result = deriveManifest(
      baseParams([file('package.json', pkg), file('package-lock.json', '{}')]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.commands.map((c) => c.kind).sort()).toEqual(['test', 'typecheck']);
  });

  // --- network policy -------------------------------------------------------

  it('scopes the install network policy to the exact registry host for the detected package manager', () => {
    const result = deriveManifest(
      baseParams([file('package.json', PKG_NO_ENGINES), file('package-lock.json', '{}')]),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.manifest.networkPolicy.install).toEqual({
      mode: 'allowlist',
      allowedHosts: ['registry.npmjs.org'],
    });
    expect(result.manifest.networkPolicy.verify).toEqual({ mode: 'deny-all' });
  });
});
