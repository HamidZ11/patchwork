import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as tar from 'tar';

/**
 * Test-only helper, duplicated from apps/api/src/__tests__/
 * build-fixture-archive.ts rather than shared across the app boundary:
 * unlike production archive-extraction logic (moved to @patchwork/archive
 * specifically to avoid duplication -- see verification-archive.ts's own
 * doc comment), a small test fixture builder carries none of the
 * maintenance/security-drift risk that justified that extraction.
 *
 * Builds a real .tar.gz buffer from a flat path->content map, wrapped in
 * a synthetic `<owner>-<repo>-<sha>/` root directory matching GitHub's
 * real tarball layout, so tests exercise the real `tar` extraction and
 * `strip: 1` code path, not a mock of it.
 */
export async function buildFixtureArchive(
  files: Record<string, string>,
  options: { rootPrefix?: string } = {},
): Promise<Buffer> {
  const rootPrefix = options.rootPrefix ?? 'owner-repo-abc1234def5678';
  const workDir = await mkdtemp(join(tmpdir(), 'patchwork-fixture-'));

  try {
    const rootDir = join(workDir, rootPrefix);
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = join(rootDir, relativePath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
    }

    const archivePath = join(workDir, 'archive.tar.gz');
    await tar.c({ gzip: true, file: archivePath, cwd: workDir }, [rootPrefix]);
    return await readFile(archivePath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
