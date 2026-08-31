import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';

const MAX_MANIFEST_ENTRY_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_SOURCE_ENTRY_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_EXTRACTED_FILES = 5000;

const MANIFEST_BASENAMES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const EXCLUDED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'out',
  'vendor',
]);

export interface ExtractedFile {
  path: string; // relative path within the repository, posix separators
  content: string;
}

export interface ExtractionResult {
  files: ExtractedFile[];
  truncated: boolean; // hit MAX_EXTRACTED_FILES; some relevant files were not extracted
  skippedLarge: string[]; // relative paths skipped for exceeding the per-entry size cap
}

function basenameOf(entryPath: string): string {
  return entryPath.split('/').pop() ?? '';
}

function isExcludedPath(entryPath: string): boolean {
  return entryPath.split('/').some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

function isRelevantPath(entryPath: string): boolean {
  if (isExcludedPath(entryPath)) return false;
  const basename = basenameOf(entryPath);
  if (MANIFEST_BASENAMES.has(basename)) return true;
  const dotIndex = basename.lastIndexOf('.');
  const extension = dotIndex === -1 ? '' : basename.slice(dotIndex);
  return SOURCE_EXTENSIONS.has(extension);
}

/**
 * Given a .tar.gz already on disk (see github/client.ts's
 * downloadRepositoryArchive), safely extracts only the files evidence
 * collection needs into a fresh OS temp directory, reads their text
 * content, and guarantees the whole temp directory (archive + extracted
 * files) is removed afterward -- on both success and failure.
 *
 * Safety: `tar` rejects/strips absolute paths and `..` traversal segments
 * by default (preservePaths is never set here) -- Zip Slip protection
 * comes from the library, not reimplemented here. On top of that,
 * extraction is selective via a filter callback (never "extract
 * everything then scan the filesystem"): only manifest/lockfile
 * basenames and known source extensions, outside excluded directories,
 * are ever written to disk, and only regular files are extracted
 * (symlinks/hardlinks are rejected). `strip: 1` removes GitHub's wrapping
 * `<owner>-<repo>-<sha>/` directory.
 */
export async function withExtractedArchive<T>(
  archivePath: string,
  handler: (result: ExtractionResult) => Promise<T> | T,
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), 'patchwork-archive-'));
  const extractDir = join(tempDir, 'extracted');

  try {
    await mkdir(extractDir, { recursive: true });

    const acceptedPaths: string[] = [];
    const skippedLarge: string[] = [];
    let truncated = false;

    await tar.x({
      file: archivePath,
      cwd: extractDir,
      strip: 1,
      filter: (entryPath, entry) => {
        if ('type' in entry && entry.type !== 'File') return false;

        // `strip: 1` removes the first path segment (GitHub's wrapping
        // `<owner>-<repo>-<sha>/` directory) from where the file actually
        // lands on disk -- entryPath here is still the pre-strip archive
        // path, so bookkeeping must strip it too or later reads mismatch
        // what tar.x actually wrote.
        const slashIndex = entryPath.indexOf('/');
        const relativePath = slashIndex === -1 ? '' : entryPath.slice(slashIndex + 1);
        if (!relativePath || !isRelevantPath(relativePath)) return false;

        const cap = MANIFEST_BASENAMES.has(basenameOf(relativePath))
          ? MAX_MANIFEST_ENTRY_BYTES
          : MAX_SOURCE_ENTRY_BYTES;
        if (entry.size > cap) {
          skippedLarge.push(relativePath);
          return false;
        }

        if (acceptedPaths.length >= MAX_EXTRACTED_FILES) {
          truncated = true;
          return false;
        }

        acceptedPaths.push(relativePath);
        return true;
      },
    });

    const files: ExtractedFile[] = [];
    for (const relativePath of acceptedPaths) {
      const content = await readFile(join(extractDir, relativePath), 'utf-8');
      files.push({ path: relativePath, content });
    }

    return await handler({ files, truncated, skippedLarge });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
