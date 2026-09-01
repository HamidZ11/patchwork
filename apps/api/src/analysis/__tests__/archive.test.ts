import { access, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixtureArchive, buildMaliciousTarGz } from '../../__tests__/build-fixture-archive.js';
import { withExtractedArchive } from '../archive.js';

async function tempDirCountUnder(prefix: string): Promise<number> {
  const entries = await readdir(tmpdir());
  return entries.filter((name) => name.startsWith(prefix)).length;
}

async function withArchivePath<T>(
  archive: Buffer,
  run: (archivePath: string) => Promise<T>,
): Promise<T> {
  const archivePath = join(
    tmpdir(),
    `test-archive-${Date.now()}-${Math.random().toString(36).slice(2)}.tar.gz`,
  );
  await writeFile(archivePath, archive);
  try {
    return await run(archivePath);
  } finally {
    await rm(archivePath, { force: true });
  }
}

describe('withExtractedArchive', () => {
  it('extracts only relevant files, stripping the GitHub-style root directory', async () => {
    const archive = await buildFixtureArchive({
      'package.json': '{"name":"demo"}',
      'src/index.ts': 'export const x = 1;',
      'node_modules/some-dep/index.js': 'module.exports = {};',
      'README.md': '# demo',
    });

    const result = await withArchivePath(archive, (archivePath) =>
      withExtractedArchive(archivePath, (r) => r),
    );

    expect(result.files.map((f) => f.path).sort()).toEqual(['package.json', 'src/index.ts']);
    expect(result.truncated).toBe(false);
  });

  it('cleans up its temp directory on success', async () => {
    const before = await tempDirCountUnder('patchwork-archive-');
    const archive = await buildFixtureArchive({ 'package.json': '{}' });

    await withArchivePath(archive, (archivePath) => withExtractedArchive(archivePath, (r) => r));

    // Polled, not a single point-in-time read: other test files run
    // concurrently and legitimately create/remove their own
    // patchwork-archive-* temp dirs via this same function (e.g.
    // remediation/), so a single snapshot can race against another
    // file's own in-flight cleanup. This still proves *this* call cleans
    // up -- it just tolerates a brief window for unrelated concurrent
    // activity to finish its own cleanup too.
    await expect.poll(() => tempDirCountUnder('patchwork-archive-')).toBe(before);
  });

  it('cleans up its temp directory even when the handler throws', async () => {
    const before = await tempDirCountUnder('patchwork-archive-');
    const archive = await buildFixtureArchive({ 'package.json': '{}' });

    await expect(
      withArchivePath(archive, (archivePath) =>
        withExtractedArchive(archivePath, () => {
          throw new Error('handler failed');
        }),
      ),
    ).rejects.toThrow('handler failed');

    await expect.poll(() => tempDirCountUnder('patchwork-archive-')).toBe(before);
  });

  it('does not extract a maliciously crafted path-traversal entry outside the temp directory', async () => {
    const escapedPath = '/tmp/patchwork-escaped-file.txt';
    const malicious = buildMaliciousTarGz(
      '../../../../../../tmp/patchwork-escaped-file.txt',
      'pwned',
    );

    try {
      const result = await withArchivePath(malicious, (archivePath) =>
        withExtractedArchive(archivePath, (r) => r),
      );
      // tar.x either rejects/strips the traversal or the filter excludes
      // the resulting basename (not a manifest/source file) -- either way
      // nothing should have been extracted, and critically, the escaped
      // path must not exist anywhere on disk.
      expect(result.files).toHaveLength(0);
      await expect(access(escapedPath)).rejects.toThrow();
    } finally {
      await rm(escapedPath, { force: true });
    }
  });

  it('does not extract a maliciously crafted absolute-path entry', async () => {
    const escapedPath = '/tmp/patchwork-absolute-escape.txt';
    const malicious = buildMaliciousTarGz(escapedPath, 'pwned');

    try {
      const result = await withArchivePath(malicious, (archivePath) =>
        withExtractedArchive(archivePath, (r) => r),
      );
      expect(result.files).toHaveLength(0);
      await expect(access(escapedPath)).rejects.toThrow();
    } finally {
      await rm(escapedPath, { force: true });
    }
  });

  it('skips an oversized entry and reports it', async () => {
    const archive = await buildFixtureArchive({
      'package.json': '{}',
      'src/huge.js': 'x'.repeat(2 * 1024 * 1024), // exceeds the 1 MB source cap
    });

    const result = await withArchivePath(archive, (archivePath) =>
      withExtractedArchive(archivePath, (r) => r),
    );

    expect(result.files.map((f) => f.path)).toEqual(['package.json']);
    expect(result.skippedLarge).toContain('src/huge.js');
  });
});
