/**
 * The repository view model shared by the index (`/repositories`) and a
 * repository's overview (`/repositories/[id]`). Pure: no fetching, no JSX,
 * so the truth rules below are unit-tested directly.
 */

export interface LatestAnalysisStripeSummary {
  resolvedVersion: string | null;
  declaredRange: string;
  workspacePath: string;
}

export type AssessmentStatus = 'AFFECTED' | 'UNCERTAIN' | 'NOT_AFFECTED';

/** One located usage, as `GET /repositories` already returns it: a
 * repository-relative file, a line and the symbol that matched. Never
 * source code. */
export interface Finding {
  workspacePath: string;
  sourceFile: string;
  line: number;
  matchedSymbol: string;
}

export interface LatestImpactAssessment {
  providerChangeTitle: string;
  status: AssessmentStatus;
  /** The analyser's own deterministic explanation of the verdict. */
  reason: string;
  findings: Finding[];
}

export interface LatestAnalysis {
  analysisRunId: string;
  commitSha: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  stripe: LatestAnalysisStripeSummary | null;
  latestImpactAssessments: LatestImpactAssessment[];
}

export interface Repository {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  latestAnalysis: LatestAnalysis | null;
}

/**
 * A repository's rolled-up verdict from its latest analysis run.
 *
 * `clear` requires explicit negative evidence: a completed run with at least
 * one assessment, every one of them `NOT_AFFECTED`. A completed run that
 * recorded no assessments at all (the impact step failed after the analysis
 * itself succeeded) is `not_assessed`, never `clear` -- the absence of an
 * assessment is not evidence that nothing is affected (CLAUDE.md's
 * abstain-on-uncertainty invariant). This previously rendered as a green
 * "Clear". A run status the web does not recognise is treated the same way:
 * it cannot produce a verdict in either direction.
 */
export type ImpactState =
  | { kind: 'affected'; affectedCount: number; uncertainCount: number; assessedCount: number }
  | { kind: 'uncertain'; uncertainCount: number; assessedCount: number }
  | { kind: 'clear'; assessedCount: number }
  | { kind: 'not_assessed' }
  | { kind: 'failed' }
  | { kind: 'not_analysed' };

export type ImpactStateKind = ImpactState['kind'];

export function computeImpactState(repo: Repository): ImpactState {
  const { latestAnalysis } = repo;
  if (!latestAnalysis) return { kind: 'not_analysed' };
  if (latestAnalysis.status === 'failed') return { kind: 'failed' };
  if (latestAnalysis.status !== 'completed') return { kind: 'not_assessed' };

  const assessments = latestAnalysis.latestImpactAssessments;
  if (assessments.length === 0) return { kind: 'not_assessed' };

  const affectedCount = assessments.filter((a) => a.status === 'AFFECTED').length;
  const uncertainCount = assessments.filter((a) => a.status === 'UNCERTAIN').length;
  const assessedCount = assessments.length;

  if (affectedCount > 0) return { kind: 'affected', affectedCount, uncertainCount, assessedCount };
  if (uncertainCount > 0) return { kind: 'uncertain', uncertainCount, assessedCount };
  return { kind: 'clear', assessedCount };
}

/** Fixed, non-configurable index order: what needs a decision first. */
export const IMPACT_STATE_PRIORITY: Record<ImpactStateKind, number> = {
  affected: 0,
  uncertain: 1,
  failed: 2,
  not_assessed: 3,
  not_analysed: 4,
  clear: 5,
};

export const IMPACT_STATE_LABEL: Record<ImpactStateKind, string> = {
  affected: 'Affected',
  uncertain: 'Uncertain',
  clear: 'Clear',
  not_assessed: 'Not assessed',
  failed: 'Failed',
  not_analysed: 'Not analysed',
};

/** Status roles (DESIGN.md Section 11). `not_assessed` joins the neutral
 * role: nothing colour-worthy happened, and it must not borrow `clear`'s
 * success colour or `failed`'s failure colour. */
export const IMPACT_STATE_STYLE: Record<ImpactStateKind, { dot: string; text: string }> = {
  affected: { dot: 'bg-mark-attention', text: 'text-attention' },
  uncertain: { dot: 'bg-mark-indeterminate', text: 'text-indeterminate' },
  clear: { dot: 'bg-mark-success', text: 'text-success' },
  not_assessed: { dot: 'bg-mark-neutral', text: 'text-fg-tertiary' },
  failed: { dot: 'bg-mark-failure', text: 'text-failure' },
  not_analysed: { dot: 'bg-mark-neutral', text: 'text-fg-tertiary' },
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The repository overview's verdict, as copy. Counts only what the evidence
 * supports: the data has no breaking-vs-deprecation field, so nothing here
 * calls a change "breaking". No em dashes in UI copy (Section 3).
 */
export function verdictCopy(state: ImpactState): {
  title: string;
  headline: string;
  secondary: string | null;
} {
  switch (state.kind) {
    // "Unresolved", as on the index: an uncertain change is not a milder
    // affected one, it is one the analysis could not decide.
    case 'affected':
      return {
        title: 'Affected',
        headline: `${state.affectedCount} of ${plural(state.assessedCount, 'tracked change', 'tracked changes')} ${state.affectedCount === 1 ? 'affects' : 'affect'} this repository`,
        secondary:
          state.uncertainCount === 0
            ? null
            : `${plural(state.uncertainCount, 'change', 'changes')} unresolved`,
      };
    case 'uncertain':
      return {
        title: 'Uncertain',
        headline: `${state.uncertainCount} of ${plural(state.assessedCount, 'tracked change', 'tracked changes')} ${state.uncertainCount === 1 ? 'is' : 'are'} unresolved`,
        secondary: 'No change is confirmed to affect this repository.',
      };
    case 'clear':
      return {
        title: 'Clear',
        headline:
          state.assessedCount === 1
            ? 'The 1 tracked change does not affect this repository'
            : `None of ${state.assessedCount} tracked changes affect this repository`,
        secondary: null,
      };
    case 'not_assessed':
      return {
        title: 'Not assessed',
        headline: 'The analysis completed without an impact assessment.',
        secondary: 'There is no verdict either way. Run the analysis again.',
      };
    case 'failed':
      return {
        title: 'Analysis failed',
        headline: 'The latest analysis did not complete.',
        secondary: 'There is no verdict for this repository until an analysis succeeds.',
      };
    case 'not_analysed':
      return {
        title: 'Not analysed yet',
        headline: 'Analyse this repository to check it against tracked Stripe changes.',
        secondary: null,
      };
  }
}

const ASSESSMENT_ORDER: Record<AssessmentStatus, number> = {
  AFFECTED: 0,
  UNCERTAIN: 1,
  NOT_AFFECTED: 2,
};

/** The API returns a run's assessments in no defined order, so sort by
 * verdict, then by `within` (title by default): the same repository always
 * lists the same way. */
export function sortAssessments(
  assessments: LatestImpactAssessment[],
  within: (a: LatestImpactAssessment, b: LatestImpactAssessment) => number = (a, b) =>
    a.providerChangeTitle.localeCompare(b.providerChangeTitle),
): LatestImpactAssessment[] {
  return [...assessments].sort(
    (a, b) => ASSESSMENT_ORDER[a.status] - ASSESSMENT_ORDER[b.status] || within(a, b),
  );
}

/**
 * The analyser's reason as product copy. The stored string opens with an
 * internal `[workspace] STATUS: ` disambiguation prefix (`[.] UNCERTAIN: `)
 * that restates the verdict shown right beside it; the impact report strips
 * the same prefix. Only a leading prefix is removed -- the reason itself is
 * never rewritten.
 */
export function reasonText(reason: string): string {
  return reason.replace(/^\[[^\]]*\]\s*(?:AFFECTED|UNCERTAIN|NOT_AFFECTED):\s*/, '');
}

/** "4 usages in 3 files", or null when there is nothing to count. */
function countUsages(findings: Finding[]): string | null {
  if (findings.length === 0) return null;
  if (findings.length === 1) return '1 usage';
  // `sourceFile` is repository-relative (the archive path), so it alone
  // identifies a file across workspaces.
  const files = new Set(findings.map((f) => f.sourceFile)).size;
  return `${findings.length} usages in ${plural(files, 'file', 'files')}`;
}

/** A usage count only exists for an AFFECTED change. Printing "0 usages"
 * beside an UNCERTAIN one would assert negative evidence the backend never
 * concluded (Section 34); an AFFECTED change with no located usage (version
 * applicability alone) gets no count either -- its reason says why. */
export function usageLabel(assessment: LatestImpactAssessment): string | null {
  return assessment.status === 'AFFECTED' ? countUsages(assessment.findings) : null;
}

/** The same count across a run: AFFECTED findings only. */
export function totalUsageLabel(assessments: LatestImpactAssessment[]): string | null {
  return countUsages(assessments.filter((a) => a.status === 'AFFECTED').flatMap((a) => a.findings));
}

/** File, then line: the order a reader would open them in. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.line - b.line);
}

export const ASSESSMENT_LABEL: Record<AssessmentStatus, string> = {
  AFFECTED: 'Affected',
  UNCERTAIN: 'Uncertain',
  NOT_AFFECTED: 'Not affected',
};

export const ASSESSMENT_STYLE: Record<AssessmentStatus, { dot: string; text: string }> = {
  AFFECTED: IMPACT_STATE_STYLE.affected,
  UNCERTAIN: IMPACT_STATE_STYLE.uncertain,
  NOT_AFFECTED: { dot: 'bg-mark-neutral', text: 'text-fg-tertiary' },
};

/** When the run actually finished; `startedAt` is a defensive fallback --
 * both `completed` and `failed` runs are written with a real `completedAt`. */
export function analysedAt(analysis: LatestAnalysis): Date {
  return new Date(analysis.completedAt ?? analysis.startedAt);
}

export function formatRelativeTime(when: Date, now: Date = new Date()): string {
  const diffMinutes = Math.round((when.getTime() - now.getTime()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  return rtf.format(Math.round(diffHours / 24), 'day');
}

export function formatAbsoluteTime(when: Date): string {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(when);
}

/** The repository root's workspace. The API derives a workspace path from
 * its manifest's directory, so the root `package.json` gives `''`; `.` is
 * accepted too rather than shown as a literal path. */
export function isRootWorkspace(workspacePath: string): boolean {
  return workspacePath === '' || workspacePath === '.';
}

/** The SDK version Patchwork resolved, or the declared range when the
 * lockfile could not pin one -- labelled, so a range never reads as a
 * resolved version. */
export function stripeVersionLabel(stripe: LatestAnalysisStripeSummary): string {
  return stripe.resolvedVersion ?? `${stripe.declaredRange} (declared)`;
}
