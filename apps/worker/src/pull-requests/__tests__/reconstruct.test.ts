import { createTwoFilesPatch } from 'diff';
import { describe, expect, it } from 'vitest';
import { reconstructFinalFileContents } from '../reconstruct.js';

function unifiedDiffFor(files: { path: string; before: string; after: string }[]): string {
  return files
    .map((file) =>
      createTwoFilesPatch(file.path, file.path, file.before, file.after, undefined, undefined, {
        context: 3,
      }),
    )
    .join('\n');
}

describe('reconstructFinalFileContents', () => {
  it('reconstructs a single changed file exactly', () => {
    const before = 'export function f() {\n  return invoice.subscription;\n}\n';
    const after =
      'export function f() {\n  return (invoice.parent?.subscription_details?.subscription ?? null);\n}\n';
    const diff = unifiedDiffFor([{ path: 'src/billing.ts', before, after }]);

    const result = reconstructFinalFileContents(
      diff,
      ['src/billing.ts'],
      new Map([['src/billing.ts', before]]),
    );

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.filesByPath.get('src/billing.ts')).toBe(after);
    }
  });

  it('reconstructs multiple changed files from one multi-file diff', () => {
    const beforeA = 'const a = invoice.subscription;\n';
    const afterA = 'const a = invoice.parent?.subscription_details?.subscription ?? null;\n';
    const beforeB = 'const b = invoice.subscription;\n';
    const afterB = 'const b = invoice.parent?.subscription_details?.subscription ?? null;\n';
    const diff = unifiedDiffFor([
      { path: 'src/a.ts', before: beforeA, after: afterA },
      { path: 'src/b.ts', before: beforeB, after: afterB },
    ]);

    const result = reconstructFinalFileContents(
      diff,
      ['src/a.ts', 'src/b.ts'],
      new Map([
        ['src/a.ts', beforeA],
        ['src/b.ts', beforeB],
      ]),
    );

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.filesByPath.get('src/a.ts')).toBe(afterA);
      expect(result.filesByPath.get('src/b.ts')).toBe(afterB);
    }
  });

  it('fails when a changed file is missing from the provided snapshot content', () => {
    const before = 'const x = 1;\n';
    const after = 'const x = 2;\n';
    const diff = unifiedDiffFor([{ path: 'src/missing.ts', before, after }]);

    const result = reconstructFinalFileContents(diff, ['src/missing.ts'], new Map());

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toContain('not found in the analysed snapshot');
    }
  });

  it('fails when the diff does not apply cleanly against the given base content', () => {
    const before = 'const x = 1;\n';
    const after = 'const x = 2;\n';
    const diff = unifiedDiffFor([{ path: 'src/x.ts', before, after }]);

    const divergedBase = 'const x = 999;\nconst y = 1;\n';
    const result = reconstructFinalFileContents(
      diff,
      ['src/x.ts'],
      new Map([['src/x.ts', divergedBase]]),
    );

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toContain('did not apply cleanly');
    }
  });

  it('fails when a persisted changed file is not covered by the diff', () => {
    const before = 'const x = 1;\n';
    const after = 'const x = 2;\n';
    const diff = unifiedDiffFor([{ path: 'src/x.ts', before, after }]);

    const result = reconstructFinalFileContents(
      diff,
      ['src/x.ts', 'src/y.ts'],
      new Map([
        ['src/x.ts', before],
        ['src/y.ts', 'const y = 1;\n'],
      ]),
    );

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toContain('not covered by the diff');
    }
  });

  it('fails when the diff references a file outside the persisted changed-files list', () => {
    const before = 'const x = 1;\n';
    const after = 'const x = 2;\n';
    const diff = unifiedDiffFor([{ path: 'src/unexpected.ts', before, after }]);

    const result = reconstructFinalFileContents(
      diff,
      ['src/x.ts'],
      new Map([['src/unexpected.ts', before]]),
    );

    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toContain('not in the persisted changed-files list');
    }
  });
});
