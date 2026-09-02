import { applyPatch, parsePatch } from 'diff';

export type ReconstructResult =
  { kind: 'ok'; filesByPath: Map<string, string> } | { kind: 'failed'; reason: string };

/**
 * Reconstructs each changed file's exact final content from the exact
 * RepositorySnapshot content plus the exact persisted PatchAttempt diff --
 * never from current mutable HEAD, never re-derived by re-running the
 * remediation recipe. Pure and deterministic: same diff + same base
 * content (both already-immutable inputs) always produce the same
 * output, so this is guaranteed identical to what the sandbox verified
 * against the same snapshot and diff.
 *
 * Uses the `diff` package's own parsePatch/applyPatch (the same library
 * that generated the diff in apps/api/src/remediation/diff.ts) rather
 * than shelling out to the `patch` CLI -- that CLI call is deliberately
 * sandbox-only (proving a real patch tool applies the diff against a real
 * filesystem); this is a different, purely in-process text transformation
 * for reconstructing exact bytes to hand to the GitHub Data API, not code
 * execution of any kind.
 */
export function reconstructFinalFileContents(
  diffText: string,
  changedFiles: string[],
  originalContentByPath: Map<string, string>,
): ReconstructResult {
  let parsedFiles;
  try {
    parsedFiles = parsePatch(diffText);
  } catch (error) {
    return {
      kind: 'failed',
      reason:
        error instanceof Error
          ? `diff could not be parsed: ${error.message}`
          : 'diff could not be parsed',
    };
  }

  const filesByPath = new Map<string, string>();

  for (const filePatch of parsedFiles) {
    const path = filePatch.newFileName;
    if (!path || !changedFiles.includes(path)) {
      return {
        kind: 'failed',
        reason: `diff references a file not in the persisted changed-files list: ${path ?? '(unknown)'}`,
      };
    }

    const original = originalContentByPath.get(path);
    if (original === undefined) {
      return { kind: 'failed', reason: `${path} was not found in the analysed snapshot` };
    }

    const result = applyPatch(original, filePatch);
    if (result === false) {
      return { kind: 'failed', reason: `diff did not apply cleanly to ${path}` };
    }
    filesByPath.set(path, result);
  }

  for (const path of changedFiles) {
    if (!filesByPath.has(path)) {
      return {
        kind: 'failed',
        reason: `${path} is in the persisted changed-files list but not covered by the diff`,
      };
    }
  }

  return { kind: 'ok', filesByPath };
}
