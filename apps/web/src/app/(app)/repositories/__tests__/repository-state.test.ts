import { describe, expect, it } from 'vitest';
import {
  computeImpactState,
  IMPACT_STATE_PRIORITY,
  sortAssessments,
  usageLabel,
  verdictCopy,
  type AssessmentStatus,
  type LatestAnalysis,
  type LatestImpactAssessment,
  type Repository,
} from '../repository-state';

function assessment(
  status: AssessmentStatus,
  title = `Change ${status}`,
  findings = 0,
): LatestImpactAssessment {
  return { providerChangeTitle: title, status, findings: Array.from({ length: findings }) };
}

function repo(analysis: Partial<LatestAnalysis> | null): Repository {
  return {
    id: 'repo-1',
    owner: 'acme',
    name: 'billing',
    fullName: 'acme/billing',
    isPrivate: false,
    defaultBranch: 'main',
    latestAnalysis:
      analysis === null
        ? null
        : {
            analysisRunId: 'run-1',
            commitSha: 'd2b1ca5e0000000000000000000000000000000',
            status: 'completed',
            startedAt: '2026-10-02T10:00:00.000Z',
            completedAt: '2026-10-02T10:01:00.000Z',
            stripe: { resolvedVersion: '18.5.0', declaredRange: '^18.0.0', workspacePath: '.' },
            latestImpactAssessments: [],
            ...analysis,
          },
  };
}

describe('computeImpactState', () => {
  it('is not_analysed when the repository has never been analysed', () => {
    expect(computeImpactState(repo(null))).toEqual({ kind: 'not_analysed' });
  });

  it('is failed when the latest run failed', () => {
    expect(computeImpactState(repo({ status: 'failed' }))).toEqual({ kind: 'failed' });
  });

  // The regression this module exists to prevent: a completed run with no
  // assessments used to render as a green "Clear" with no evidence behind it.
  it('is not_assessed, never clear, when a completed run recorded no assessments', () => {
    expect(computeImpactState(repo({ latestImpactAssessments: [] }))).toEqual({
      kind: 'not_assessed',
    });
  });

  it('is not_assessed for a run status it does not recognise', () => {
    expect(
      computeImpactState(
        repo({ status: 'running', latestImpactAssessments: [assessment('NOT_AFFECTED')] }),
      ),
    ).toEqual({ kind: 'not_assessed' });
  });

  it('is clear only when every assessment is NOT_AFFECTED', () => {
    const state = computeImpactState(
      repo({ latestImpactAssessments: [assessment('NOT_AFFECTED'), assessment('NOT_AFFECTED')] }),
    );
    expect(state).toEqual({ kind: 'clear', assessedCount: 2 });
  });

  it('is uncertain when nothing is affected but something is uncertain', () => {
    const state = computeImpactState(
      repo({ latestImpactAssessments: [assessment('UNCERTAIN'), assessment('NOT_AFFECTED')] }),
    );
    expect(state).toEqual({ kind: 'uncertain', uncertainCount: 1, assessedCount: 2 });
  });

  it('is affected when any assessment is AFFECTED, keeping the uncertain count', () => {
    const state = computeImpactState(
      repo({
        latestImpactAssessments: [
          assessment('AFFECTED'),
          assessment('AFFECTED'),
          assessment('AFFECTED'),
          assessment('UNCERTAIN'),
        ],
      }),
    );
    expect(state).toEqual({
      kind: 'affected',
      affectedCount: 3,
      uncertainCount: 1,
      assessedCount: 4,
    });
  });
});

describe('IMPACT_STATE_PRIORITY', () => {
  it('orders what needs a decision first and clear last', () => {
    const kinds = Object.entries(IMPACT_STATE_PRIORITY)
      .sort(([, a], [, b]) => a - b)
      .map(([kind]) => kind);
    expect(kinds).toEqual([
      'affected',
      'uncertain',
      'failed',
      'not_assessed',
      'not_analysed',
      'clear',
    ]);
  });
});

describe('verdictCopy', () => {
  it('counts affected and uncertain changes without calling them breaking', () => {
    const copy = verdictCopy({
      kind: 'affected',
      affectedCount: 3,
      uncertainCount: 1,
      assessedCount: 4,
    });
    expect(copy).toEqual({
      title: 'Affected',
      headline: '3 changes affect this repository',
      secondary: '1 uncertain change needs review',
    });
    expect(JSON.stringify(copy)).not.toMatch(/breaking/i);
  });

  it('omits the uncertain line when there is nothing uncertain', () => {
    expect(
      verdictCopy({ kind: 'affected', affectedCount: 1, uncertainCount: 0, assessedCount: 4 }),
    ).toMatchObject({ headline: '1 change affects this repository', secondary: null });
  });

  it('states the negative evidence a clear verdict rests on', () => {
    expect(verdictCopy({ kind: 'clear', assessedCount: 4 }).headline).toBe(
      'None of 4 tracked changes affect this repository',
    );
  });

  it('never presents a missing assessment as a verdict', () => {
    expect(verdictCopy({ kind: 'not_assessed' }).secondary).toMatch(/no verdict either way/);
  });

  it('uses no em dashes in UI copy', () => {
    const states = [
      { kind: 'affected', affectedCount: 2, uncertainCount: 2, assessedCount: 4 },
      { kind: 'uncertain', uncertainCount: 2, assessedCount: 4 },
      { kind: 'clear', assessedCount: 1 },
      { kind: 'not_assessed' },
      { kind: 'failed' },
      { kind: 'not_analysed' },
    ] as const;
    for (const state of states) expect(JSON.stringify(verdictCopy(state))).not.toContain('—');
  });
});

describe('sortAssessments', () => {
  it('orders by verdict, then title, regardless of API order', () => {
    const sorted = sortAssessments([
      assessment('NOT_AFFECTED', 'A'),
      assessment('UNCERTAIN', 'B'),
      assessment('AFFECTED', 'Z'),
      assessment('AFFECTED', 'C'),
    ]);
    expect(sorted.map((a) => `${a.status}:${a.providerChangeTitle}`)).toEqual([
      'AFFECTED:C',
      'AFFECTED:Z',
      'UNCERTAIN:B',
      'NOT_AFFECTED:A',
    ]);
  });
});

describe('usageLabel', () => {
  it('counts confirmed usages only for an affected change', () => {
    expect(usageLabel(assessment('AFFECTED', 'x', 2))).toBe('2 confirmed usages');
    expect(usageLabel(assessment('AFFECTED', 'x', 1))).toBe('1 confirmed usage');
  });

  it('never prints a zero count for an uncertain change', () => {
    expect(usageLabel(assessment('UNCERTAIN'))).toBeNull();
    expect(usageLabel(assessment('NOT_AFFECTED'))).toBeNull();
  });
});
