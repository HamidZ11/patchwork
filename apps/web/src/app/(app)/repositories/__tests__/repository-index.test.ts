import { describe, expect, it } from 'vitest';
import {
  buildRepositoryIndex,
  filterRows,
  indexHref,
  latestAnalysis,
  parseChange,
  parseView,
  verdictDetail,
} from '../repository-index';
import type {
  AssessmentStatus,
  LatestAnalysis,
  LatestImpactAssessment,
  Repository,
} from '../repository-state';

const NOW = new Date('2026-10-06T12:00:00.000Z');

function assessment(title: string, status: AssessmentStatus, findings = 0): LatestImpactAssessment {
  return {
    providerChangeTitle: title,
    status,
    reason: '',
    findings: Array.from({ length: findings }, (_, i) => ({
      workspacePath: '.',
      sourceFile: `src/${title}-${i}.ts`,
      line: i + 1,
      matchedSymbol: 'x',
    })),
  };
}

function repo(
  name: string,
  analysis: Partial<LatestAnalysis> | null,
  extra: Partial<Repository> = {},
): Repository {
  return {
    id: `id-${name}`,
    owner: 'acme',
    name,
    fullName: `acme/${name}`,
    isPrivate: false,
    defaultBranch: 'main',
    latestAnalysis:
      analysis === null
        ? null
        : {
            analysisRunId: `run-${name}`,
            commitSha: 'd2b1ca5e00000000000000000000000000000000',
            status: 'completed',
            startedAt: '2026-10-06T10:00:00.000Z',
            completedAt: '2026-10-06T10:01:00.000Z',
            stripe: { resolvedVersion: '18.5.0', declaredRange: '^18.0.0', workspacePath: '.' },
            latestImpactAssessments: [],
            ...analysis,
          },
    ...extra,
  };
}

const ESTATE = [
  repo('clear-one', {
    latestImpactAssessments: [assessment('A', 'NOT_AFFECTED'), assessment('B', 'NOT_AFFECTED')],
  }),
  repo('hit-once', {
    latestImpactAssessments: [assessment('A', 'NOT_AFFECTED'), assessment('B', 'AFFECTED', 1)],
  }),
  repo('hit-twice', {
    latestImpactAssessments: [assessment('A', 'AFFECTED', 2), assessment('B', 'AFFECTED', 3)],
  }),
  repo('unsure', {
    latestImpactAssessments: [assessment('A', 'UNCERTAIN'), assessment('B', 'NOT_AFFECTED')],
  }),
  repo('never', null),
  repo('broken', { status: 'failed', stripe: null }),
  repo('no-assessment', { latestImpactAssessments: [] }),
];

describe('buildRepositoryIndex', () => {
  const index = buildRepositoryIndex(ESTATE, NOW);

  it('orders tracked changes by how many repositories they affect', () => {
    expect(index.changes.map((c) => [c.label, c.title, c.affectedRepos, c.uncertainRepos])).toEqual(
      [
        ['01', 'B', 2, 0],
        ['02', 'A', 1, 1],
      ],
    );
  });

  it('puts attention first, then failed, not assessed, never analysed, then clear', () => {
    expect(index.rows.map((r) => r.name)).toEqual([
      'hit-twice',
      'hit-once',
      'unsure',
      'broken',
      'no-assessment',
      'never',
      'clear-one',
    ]);
  });

  it('lines every row up against the same change columns', () => {
    const byName = Object.fromEntries(index.rows.map((r) => [r.name, r.cells]));
    expect(byName['hit-twice']).toEqual([
      { status: 'AFFECTED', usages: 3 },
      { status: 'AFFECTED', usages: 2 },
    ]);
    expect(byName['unsure']).toEqual([
      { status: 'NOT_AFFECTED', usages: null },
      { status: 'UNCERTAIN', usages: null },
    ]);
    // No analysis and no assessment are both "unknown", never "not affected".
    expect(byName['never']).toEqual([
      { status: null, usages: null },
      { status: null, usages: null },
    ]);
    expect(byName['no-assessment']).toEqual(byName['never']);
  });

  it('never counts usages for anything but a confirmed AFFECTED change', () => {
    const byName = Object.fromEntries(index.rows.map((r) => [r.name, r]));
    expect(byName['hit-twice'].usageCount).toBe(5);
    expect(byName['unsure'].usageCount).toBe(0);
    expect(byName['unsure'].cells.every((c) => c.usages === null)).toBe(true);
  });

  it('keeps a completed run with no assessments out of Clear', () => {
    const row = index.rows.find((r) => r.name === 'no-assessment')!;
    expect(row.state.kind).toBe('not_assessed');
    expect(row.group).toBe('pending');
  });

  it('ignores assessments from a run status it does not recognise', () => {
    const odd = buildRepositoryIndex(
      [
        repo('odd', {
          status: 'running',
          latestImpactAssessments: [assessment('Z', 'AFFECTED', 4)],
        }),
      ],
      NOW,
    );
    expect(odd.changes).toEqual([]);
    expect(odd.rows[0].state.kind).toBe('not_assessed');
    expect(odd.rows[0].usageCount).toBe(0);
  });

  it('counts every state and group from the same rows it renders', () => {
    expect(index.counts).toEqual({
      affected: 2,
      uncertain: 1,
      clear: 1,
      failed: 1,
      not_assessed: 1,
      not_analysed: 1,
    });
    expect(index.groupCounts).toEqual({ attention: 3, pending: 3, clear: 1 });
  });

  it('labels a declared range as declared, never as a resolved version', () => {
    const declared = buildRepositoryIndex(
      [
        repo('ranged', {
          stripe: { resolvedVersion: null, declaredRange: '>=17 <19', workspacePath: '.' },
          latestImpactAssessments: [assessment('A', 'NOT_AFFECTED')],
        }),
      ],
      NOW,
    );
    expect(declared.rows[0].sdk).toEqual({ version: '>=17 <19', declared: true });
  });

  it('encodes the repository id into the overview link', () => {
    const odd = buildRepositoryIndex([repo('x', null, { id: 'a/b?c' })], NOW);
    expect(odd.rows[0].href).toBe('/repositories/a%2Fb%3Fc');
  });
});

describe('verdictDetail', () => {
  const index = buildRepositoryIndex(ESTATE, NOW);
  const detail = Object.fromEntries(index.rows.map((r) => [r.name, verdictDetail(r)]));

  it('states only what the evidence supports', () => {
    expect(detail).toEqual({
      'hit-twice': '2 changes · 5 usages',
      'hit-once': '1 change · 1 usage',
      unsure: '1 change unresolved',
      broken: 'Did not complete',
      'no-assessment': 'No assessment',
      never: 'Never run',
      'clear-one': '2 checked',
    });
  });
});

describe('filtering', () => {
  const index = buildRepositoryIndex(ESTATE, NOW);
  const names = (rows: { name: string }[]) => rows.map((r) => r.name);

  it('accepts only known views and falls back to everything', () => {
    expect(parseView('attention')).toBe('attention');
    expect(parseView('pending')).toBe('pending');
    expect(parseView('clear')).toBe('clear');
    expect(parseView('nonsense')).toBe('all');
    expect(parseView(undefined)).toBe('all');
  });

  it('resolves a change by its title, never by its position label', () => {
    expect(parseChange('B', index.changes)?.label).toBe('01');
    expect(parseChange('01', index.changes)).toBeNull();
    expect(parseChange(undefined, index.changes)).toBeNull();
  });

  it('builds filter links that round-trip through the parsers', () => {
    const changeA = parseChange('A', index.changes)!;
    expect(indexHref('all', null)).toBe('/repositories');
    expect(indexHref('attention', null)).toBe('/repositories?view=attention');
    const href = indexHref('attention', changeA);
    const params = new URL(href, 'https://patchwork.test').searchParams;
    expect(parseView(params.get('view') ?? undefined)).toBe('attention');
    expect(parseChange(params.get('change') ?? undefined, index.changes)).toBe(changeA);
  });

  it('narrows to one group', () => {
    expect(names(filterRows(index.rows, 'attention', null))).toEqual([
      'hit-twice',
      'hit-once',
      'unsure',
    ]);
    expect(names(filterRows(index.rows, 'clear', null))).toEqual(['clear-one']);
  });

  it('narrows to the repositories a change confirms or leaves unresolved', () => {
    const changeA = parseChange('A', index.changes)!;
    // hit-twice is AFFECTED by A, unsure is UNCERTAIN on A; hit-once and
    // clear-one are NOT_AFFECTED; never/no-assessment have no evidence.
    expect(names(filterRows(index.rows, 'all', changeA))).toEqual(['hit-twice', 'unsure']);
  });

  it('combines a group and a change', () => {
    const changeB = parseChange('B', index.changes)!;
    expect(names(filterRows(index.rows, 'clear', changeB))).toEqual([]);
  });

  it('reports the most recent analysis across the estate', () => {
    expect(latestAnalysis(index.rows)?.iso).toBe('2026-10-06T10:01:00.000Z');
    expect(latestAnalysis([])).toBeNull();
  });
});
