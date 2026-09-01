import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';

// Deliberately independent of apps/api's analysis/archive.ts (evidence-
// scan extraction) rather than a shared/parameterized rewrite of it: that
// extraction narrows to TS/JS+manifest files (all evidence collection and
// impact analysis ever need to read as text) and is imported by ~18
// files across apps/api. Sandbox verification needs something with a
// fundamentally different allowlist policy (the *whole* repository a
// real `npm install`/build/test would see -- JSON fixtures, YAML config,
// markdown, binary assets) and different content semantics (every file
// read as base64, never assumed UTF-8 text, so binary content survives
// the round trip into the sandbox unmodified). Duplicating the ~20-line
// tar-invocation shape here is a smaller, safer, more auditable change
// than parameterizing already-working, heavily-depended-on code -- both
// functions independently apply the same tar-level safety defaults
// (rejects/strips absolute paths and `..` traversal, regular files only,
// `strip: 1` for GitHub's wrapping directory), so a reviewer can compare
// the two safety postures side by side rather than trusting one shared,
// harder-to-audit abstraction.

const MAX_VERIFICATION_ENTRY_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_VERIFICATION_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB per repository
const MAX_VERIFICATION_FILES = 5000;

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

export interface VerificationExtractedFile {
  path: string; // relative path within the repository, posix separators
  contentBase64: string;
}

export interface VerificationExtractionResult {
  files: VerificationExtractedFile[];
  truncated: boolean; // hit the file-count or total-byte budget -- the snapshot is incomplete
  skippedLarge: string[]; // relative paths skipped for exceeding the per-entry size cap
}

function isExcludedPath(entryPath: string): boolean {
  return entryPath.split('/').some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

/**
 * Given a .tar.gz already on disk (see @patchwork/github's
 * downloadRepositoryArchive), extracts the full repository content a
 * package-manager install/typecheck/test run would need -- unlike
 * evidence-scan extraction, not narrowed to TS/JS+manifest files, since
 * "restore the exact snapshot" for sandbox verification means the real
 * repository, not just the subset useful for a text scan. Still bounded:
 * per-file size cap, a total-byte budget (uploading an entire repository
 * into a sandbox is a materially larger payload than a handful of source
 * files), and a file-count cap. If any budget is hit, `truncated: true`
 * is set -- callers MUST treat a truncated extraction as unfit for
 * verification (an incomplete snapshot can't be trusted to produce a
 * correct install/build/test result) rather than silently proceeding.
 *
 * Safety: identical posture to analysis/archive.ts's withExtractedArchive
 * -- `tar` rejects/strips absolute paths and `..` traversal by default
 * (preservePaths never set), only regular files are extracted
 * (symlinks/hardlinks rejected), `strip: 1` removes GitHub's wrapping
 * `<owner>-<repo>-<sha>/` directory, and the whole temp directory is
 * guaranteed removed afterward on both success and failure.
 */
export async function withExtractedArchiveForVerification<T>(
  archivePath: string,
  handler: (result: VerificationExtractionResult) => Promise<T> | T,
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), 'patchwork-archive-verify-'));
  const extractDir = join(tempDir, 'extracted');

  try {
    await mkdir(extractDir, { recursive: true });

    const acceptedPaths: string[] = [];
    const skippedLarge: string[] = [];
    let truncated = false;
    let totalBytes = 0;

    await tar.x({
      file: archivePath,
      cwd: extractDir,
      strip: 1,
      filter: (entryPath, entry) => {
        if ('type' in entry && entry.type !== 'File') return false;

        const slashIndex = entryPath.indexOf('/');
        const relativePath = slashIndex === -1 ? '' : entryPath.slice(slashIndex + 1);
        if (!relativePath || isExcludedPath(relativePath)) return false;

        if (entry.size > MAX_VERIFICATION_ENTRY_BYTES) {
          skippedLarge.push(relativePath);
          return false;
        }

        if (
          acceptedPaths.length >= MAX_VERIFICATION_FILES ||
          totalBytes + entry.size > MAX_VERIFICATION_TOTAL_BYTES
        ) {
          truncated = true;
          return false;
        }

        acceptedPaths.push(relativePath);
        totalBytes += entry.size;
        return true;
      },
    });

    const files: VerificationExtractedFile[] = [];
    for (const relativePath of acceptedPaths) {
      const buffer = await readFile(join(extractDir, relativePath));
      files.push({ path: relativePath, contentBase64: buffer.toString('base64') });
    }

    return await handler({ files, truncated, skippedLarge });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
