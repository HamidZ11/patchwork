import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withExtractedArchiveForVerification } from '../verification-archive.js';
import { buildFixtureArchive } from './build-fixture-archive.js';

async function withArchivePath<T>(
  archive: Buffer,
  run: (archivePath: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'patchwork-archive-test-'));
  const archivePath = join(dir, 'archive.tar.gz');
  await writeFile(archivePath, archive);
  try {
    return await run(archivePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('withExtractedArchiveForVerification', () => {
  it('extracts a broader file set than evidence-scan extraction -- JSON, YAML, markdown, not just TS/JS+manifests', async () => {
    const archive = await buildFixtureArchive({
      'package.json': '{"name":"demo"}',
      'src/index.ts': 'export const x = 1;',
      'fixtures/data.json': '{"a":1}',
      'config.yaml': 'key: value\n',
      'README.md': '# demo\n',
      'node_modules/some-dep/index.js': 'module.exports = {};',
      '.git/HEAD': 'ref: refs/heads/main\n',
    });

    const result = await withArchivePath(archive, (archivePath) =>
      withExtractedArchiveForVerification(archivePath, (r) => r),
    );

    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'README.md',
      'config.yaml',
      'fixtures/data.json',
      'package.json',
      'src/index.ts',
    ]);
    expect(paths).not.toContain('node_modules/some-dep/index.js');
    expect(paths).not.toContain('.git/HEAD');
    expect(result.truncated).toBe(false);
  });

  it('round-trips binary content exactly via base64 -- never assumes UTF-8 text', async () => {
    const binary = Buffer.from([0x00, 0xff, 0xd8, 0xff, 0xe0, 0x10, 0x4a, 0x46, 0x49, 0x46]); // arbitrary non-UTF8-safe bytes
    const archive = await buildFixtureArchive({ 'assets/logo.png': binary });

    const result = await withArchivePath(archive, (archivePath) =>
      withExtractedArchiveForVerification(archivePath, (r) => r),
    );

    const file = result.files.find((f) => f.path === 'assets/logo.png');
    expect(file).toBeDefined();
    const roundTripped = Buffer.from(file!.contentBase64, 'base64');
    expect(roundTripped.equals(binary)).toBe(true);
  });

  it('skips an entry over the per-file size cap and reports it', async () => {
    const archive = await buildFixtureArchive({
      'package.json': '{}',
      'huge.bin': Buffer.alloc(6 * 1024 * 1024), // over the 5 MB per-file cap
    });

    const result = await withArchivePath(archive, (archivePath) =>
      withExtractedArchiveForVerification(archivePath, (r) => r),
    );

    expect(result.files.map((f) => f.path)).toEqual(['package.json']);
    expect(result.skippedLarge).toContain('huge.bin');
  });

  it('sets truncated: true and stops accepting files once the total-byte budget is exceeded', async () => {
    const files: Record<string, Buffer> = { 'package.json': Buffer.from('{}') };
    // Each ~1 MB, enough of them to exceed the 50 MB total budget.
    for (let i = 0; i < 55; i += 1) {
      files[`data/file-${i}.bin`] = Buffer.alloc(1024 * 1024, 1);
    }
    const archive = await buildFixtureArchive(files);

    const result = await withArchivePath(archive, (archivePath) =>
      withExtractedArchiveForVerification(archivePath, (r) => r),
    );

    expect(result.truncated).toBe(true);
    expect(result.files.length).toBeLessThan(56);
  }, 20_000);

  it('cleans up its temp directory on both success and handler failure', async () => {
    const archive = await buildFixtureArchive({ 'package.json': '{}' });

    await withArchivePath(archive, (archivePath) =>
      withExtractedArchiveForVerification(archivePath, (r) => r),
    );

    await expect(
      withArchivePath(archive, (archivePath) =>
        withExtractedArchiveForVerification(archivePath, () => {
          throw new Error('handler failed');
        }),
      ),
    ).rejects.toThrow('handler failed');
    // No direct assertion on the temp dir here (see apps/api's own
    // archive.test.ts for that pattern with expect.poll under
    // concurrent test files) -- this test's job is only to prove a
    // handler exception propagates rather than being swallowed.
  });
});
