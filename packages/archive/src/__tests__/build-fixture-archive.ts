import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as tar from 'tar';

/**
 * Test-only helper (same shape as apps/api's and apps/worker's own
 * copies -- see verification-archive.ts's doc comment for why test
 * fixture builders are fine to duplicate even though production
 * extraction logic isn't). Accepts Buffer content so tests can exercise
 * binary-safe round-tripping, not just text fixtures.
 */
export async function buildFixtureArchive(
  files: Record<string, string | Buffer>,
  options: { rootPrefix?: string } = {},
): Promise<Buffer> {
  const rootPrefix = options.rootPrefix ?? 'owner-repo-abc1234def5678';
  const workDir = await mkdtemp(join(tmpdir(), 'patchwork-archive-fixture-'));

  try {
    const rootDir = join(workDir, rootPrefix);
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = join(rootDir, relativePath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const archivePath = join(workDir, 'archive.tar.gz');
    await tar.c({ gzip: true, file: archivePath, cwd: workDir }, [rootPrefix]);
    return await readFile(archivePath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
