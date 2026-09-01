import { createTwoFilesPatch } from 'diff';

/**
 * A small, correct multi-hunk unified diff for a candidate patch --
 * delegated to a tiny, dependency-free, widely-used library rather than
 * hand-rolled, since getting hunk boundaries/line numbers right for
 * multiple non-contiguous edits in one file (see fixture: "multiple
 * supported findings in one file") is exactly the kind of thing that's
 * easy to get subtly wrong by hand.
 */
export function buildUnifiedDiff(files: { path: string; before: string; after: string }[]): string {
  return files
    .map((file) =>
      createTwoFilesPatch(file.path, file.path, file.before, file.after, undefined, undefined, {
        context: 3,
      }),
    )
    .join('\n');
}
