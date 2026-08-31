import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as tar from 'tar';

/**
 * Builds a real .tar.gz buffer from a flat path->content map, wrapped in a
 * synthetic `<owner>-<repo>-<sha>/` root directory matching GitHub's real
 * tarball layout -- so tests exercise the actual `tar` extraction and
 * `strip: 1` code path in analysis/archive.ts, not a mock of it. Files are
 * staged on disk in a scratch temp directory (deleted afterward) and
 * packed with the real `tar` library.
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

function ustarHeader(entryPath: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(entryPath, 0, 100, 'utf-8');
  header.write('0000777\0', 100, 8, 'utf-8'); // mode
  header.write('0000000\0', 108, 8, 'utf-8'); // uid
  header.write('0000000\0', 116, 8, 'utf-8'); // gid
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf-8'); // size
  header.write('00000000000\0', 136, 12, 'utf-8'); // mtime
  header.write('        ', 148, 8, 'utf-8'); // checksum placeholder: 8 spaces
  header.write('0', 156, 1, 'utf-8'); // typeflag: '0' = regular file
  header.write('ustar\0', 257, 6, 'utf-8'); // magic
  header.write('00', 263, 2, 'utf-8'); // version

  let checksum = 0;
  for (let i = 0; i < 512; i += 1) checksum += header[i]!;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf-8');

  return header;
}

/**
 * Hand-builds a single-entry .tar.gz with an attacker-controlled entry
 * path (e.g. `../../etc/evil` or an absolute path) -- deliberately bypasses
 * both the real `tar` package's packing (which would refuse or normalize
 * such a path from a real on-disk file) and this repo's own fixture
 * builder above, to prove `tar.x`'s Zip Slip protection actually rejects
 * it on extraction (see analysis/archive.test.ts).
 */
export function buildMaliciousTarGz(entryPath: string, content: string): Buffer {
  const contentBuffer = Buffer.from(content, 'utf-8');
  const header = ustarHeader(entryPath, contentBuffer.length);
  const paddedSize = Math.ceil(contentBuffer.length / 512) * 512;
  const paddedContent = Buffer.alloc(paddedSize);
  contentBuffer.copy(paddedContent);
  const endMarker = Buffer.alloc(1024); // two zero blocks mark end of archive

  return gzipSync(Buffer.concat([header, paddedContent, endMarker]));
}
