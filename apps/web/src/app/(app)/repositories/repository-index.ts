/**
 * The repository index's view model (DESIGN.md Amendment B5): the tracked
 * change set, one matrix row per repository, and the counts the summary
 * states. Pure -- built from the real `GET /repositories` DTO through the
 * truth rules in `repository-state.ts`, so it is unit-tested directly.
 */
import {
  analysedAt,
  computeImpactState,
  formatAbsoluteTime,
  formatRelativeTime,
  IMPACT_STATE_PRIORITY,
  type AssessmentStatus,
  type ImpactState,
  type ImpactStateKind,
  type Repository,
} from './repository-state';

/** Attention leads the list; everything else follows in priority order. */
export type IndexGroup = 'attention' | 'pending' | 'clear';

export interface TrackedChange {
  index: number;
  /** Stable two-digit column label, `01`, `02`, ... */
  label: string;
  title: string;
  affectedRepos: number;
  uncertainRepos: number;
}

export interface MatrixCell {
  status: AssessmentStatus | null;
  /** Confirmed usages -- only ever present for an AFFECTED cell. */
  usages: number | null;
}

export interface IndexRow {
  id: string;
  href: string;
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  branch: string;
  state: ImpactState;
  group: IndexGroup;
  sdk: { version: string; declared: boolean } | null;
  sha: string | null;
  analysed: { iso: string; relative: string; absolute: string } | null;
  assessedCount: number;
  usageCount: number;
  /** One cell per tracked change, in `changes` order. */
  cells: MatrixCell[];
}

export interface RepositoryIndex {
  rows: IndexRow[];
  changes: TrackedChange[];
  counts: Record<ImpactStateKind, number>;
  groupCounts: Record<IndexGroup, number>;
}

export function groupOf(kind: ImpactStateKind): IndexGroup {
  if (kind === 'affected' || kind === 'uncertain') return 'attention';
  if (kind === 'clear') return 'clear';
  return 'pending';
}

export function buildRepositoryIndex(
  repositories: Repository[],
  now: Date = new Date(),
): RepositoryIndex {
  // A run that produced no verdict contributes nothing: an assessment left
  // over from an unrecognised run status is not evidence either way.
  const assessed = repositories.map((repo) => {
    const state = computeImpactState(repo);
    const assessments =
      state.kind === 'not_assessed' ? [] : (repo.latestAnalysis?.latestImpactAssessments ?? []);
    return { repo, state, assessments };
  });

  // The tracked change set is whatever the estate was actually assessed
  // against, ordered by how many repositories each change affects. Keyed by
  // title: the list DTO carries no provider-change id.
  const byTitle = new Map<string, { affected: number; uncertain: number }>();
  for (const { assessments } of assessed) {
    for (const a of assessments) {
      const entry = byTitle.get(a.providerChangeTitle) ?? { affected: 0, uncertain: 0 };
      if (a.status === 'AFFECTED') entry.affected += 1;
      if (a.status === 'UNCERTAIN') entry.uncertain += 1;
      byTitle.set(a.providerChangeTitle, entry);
    }
  }
  const changes: TrackedChange[] = [...byTitle.entries()]
    .sort(
      ([ta, a], [tb, b]) =>
        b.affected - a.affected || b.uncertain - a.uncertain || ta.localeCompare(tb),
    )
    .map(([title, c], index) => ({
      index,
      label: String(index + 1).padStart(2, '0'),
      title,
      affectedRepos: c.affected,
      uncertainRepos: c.uncertain,
    }));

  const rows: IndexRow[] = assessed.map(({ repo, state, assessments }) => {
    const analysis = repo.latestAnalysis;
    const when = analysis ? analysedAt(analysis) : null;
    return {
      id: repo.id,
      href: `/repositories/${encodeURIComponent(repo.id)}`,
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      isPrivate: repo.isPrivate,
      branch: repo.defaultBranch,
      state,
      group: groupOf(state.kind),
      sdk: analysis?.stripe
        ? {
            version: analysis.stripe.resolvedVersion ?? analysis.stripe.declaredRange,
            declared: analysis.stripe.resolvedVersion === null,
          }
        : null,
      sha: analysis ? analysis.commitSha.slice(0, 7) : null,
      analysed: when
        ? {
            iso: when.toISOString(),
            relative: formatRelativeTime(when, now),
            absolute: formatAbsoluteTime(when),
          }
        : null,
      assessedCount: assessments.length,
      usageCount: assessments
        .filter((a) => a.status === 'AFFECTED')
        .reduce((sum, a) => sum + a.findings.length, 0),
      cells: changes.map((change) => {
        const match = assessments.find((a) => a.providerChangeTitle === change.title);
        return {
          status: match?.status ?? null,
          usages: match?.status === 'AFFECTED' ? match.findings.length : null,
        };
      }),
    };
  });

  rows.sort(
    (a, b) =>
      IMPACT_STATE_PRIORITY[a.state.kind] - IMPACT_STATE_PRIORITY[b.state.kind] ||
      affectedCount(b.state) - affectedCount(a.state) ||
      a.name.localeCompare(b.name),
  );

  const counts: Record<ImpactStateKind, number> = {
    affected: 0,
    uncertain: 0,
    clear: 0,
    not_assessed: 0,
    failed: 0,
    not_analysed: 0,
  };
  const groupCounts: Record<IndexGroup, number> = { attention: 0, pending: 0, clear: 0 };
  for (const row of rows) {
    counts[row.state.kind] += 1;
    groupCounts[row.group] += 1;
  }

  return { rows, changes, counts, groupCounts };
}

function affectedCount(state: ImpactState): number {
  return state.kind === 'affected' ? state.affectedCount : 0;
}

/** The short line under a verdict. Counts only what the evidence supports:
 * a usage count exists only for confirmed (AFFECTED) changes. */
export function verdictDetail(row: IndexRow): string {
  switch (row.state.kind) {
    // The verdict word beside this says "Affected" (proven) or "Uncertain";
    // an uncertain change is called unresolved so the two never read as
    // degrees of the same thing.
    case 'affected': {
      const changes = row.state.affectedCount;
      return `${changes} ${changes === 1 ? 'change' : 'changes'} · ${row.usageCount} ${row.usageCount === 1 ? 'usage' : 'usages'}`;
    }
    case 'uncertain': {
      const changes = row.state.uncertainCount;
      return `${changes} ${changes === 1 ? 'change' : 'changes'} unresolved`;
    }
    case 'clear':
      return `${row.assessedCount} checked`;
    case 'failed':
      return 'Did not complete';
    case 'not_assessed':
      return 'No assessment';
    case 'not_analysed':
      return 'Never run';
  }
}

/** What the list is narrowed to: a group (or everything), and optionally one
 * tracked change. Both come from the URL, so every filter is a link. */
export type IndexView = 'all' | IndexGroup;

export function parseView(value: string | undefined): IndexView {
  return value === 'attention' || value === 'pending' || value === 'clear' ? value : 'all';
}

/** `?change=<title>` -> that tracked change, if the estate is assessed
 * against it. Keyed by title, not by the `01` label: labels follow how many
 * repositories each change affects, so a shared link would silently point
 * at a different change after the next analysis. */
export function parseChange(
  value: string | undefined,
  changes: TrackedChange[],
): TrackedChange | null {
  return changes.find((change) => change.title === value) ?? null;
}

/** The index URL for a view and change filter; defaults are left out. */
export function indexHref(view: IndexView, change: TrackedChange | null): string {
  const params = new URLSearchParams();
  if (view !== 'all') params.set('view', view);
  if (change) params.set('change', change.title);
  const query = params.toString();
  return query ? `/repositories?${query}` : '/repositories';
}

/** Repositories a change touches: confirmed (AFFECTED) or unresolved
 * (UNCERTAIN). A NOT_AFFECTED or unassessed repository is not "hit". */
export function isHitBy(row: IndexRow, change: TrackedChange): boolean {
  const status = row.cells[change.index]?.status;
  return status === 'AFFECTED' || status === 'UNCERTAIN';
}

export function filterRows(
  rows: IndexRow[],
  view: IndexView,
  change: TrackedChange | null,
): IndexRow[] {
  return rows.filter(
    (row) => (view === 'all' || row.group === view) && (!change || isHitBy(row, change)),
  );
}

/** The most recent completed or failed analysis across the estate. */
export function latestAnalysis(rows: IndexRow[]): IndexRow['analysed'] {
  return rows.reduce<IndexRow['analysed']>(
    (latest, row) =>
      row.analysed && (!latest || row.analysed.iso > latest.iso) ? row.analysed : latest,
    null,
  );
}
