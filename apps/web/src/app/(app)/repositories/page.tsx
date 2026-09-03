import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariantClassName } from '@/components/button-styles';
import { ErrorBanner } from '@/components/error-banner';
import { FormSubmitButton } from '@/components/form-submit-button';
import { apiFetch, API_URL } from '@/lib/api';

interface LatestAnalysisStripeSummary {
  resolvedVersion: string | null;
  declaredRange: string;
  workspacePath: string;
}

interface LatestImpactAssessment {
  providerChangeTitle: string;
  status: 'AFFECTED' | 'UNCERTAIN' | 'NOT_AFFECTED';
  findings: unknown[];
}

interface LatestAnalysis {
  analysisRunId: string;
  commitSha: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  stripe: LatestAnalysisStripeSummary | null;
  latestImpactAssessments: LatestImpactAssessment[];
}

interface Repository {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  latestAnalysis: LatestAnalysis | null;
}

function countByStatus(assessments: LatestImpactAssessment[]): Record<string, number> {
  const counts: Record<string, number> = { AFFECTED: 0, UNCERTAIN: 0, NOT_AFFECTED: 0 };
  for (const assessment of assessments) {
    if (assessment.status in counts) counts[assessment.status] += 1;
  }
  return counts;
}

/**
 * What a developer actually cares about once a repository is connected --
 * "Connected" itself stopped being interesting the moment it became true
 * for every row on this page (see DESIGN.md Section 11's repurposing of
 * the emerald role: "no known impact" is the same "genuine positive
 * outcome" emerald already meant, just answering a more useful question).
 * `NOT_AFFECTED`-only findings are real evidence Patchwork already
 * computed, not a lack of one -- `clear` reflects that a completed
 * analysis found nothing, not that nothing happened.
 */
type ImpactState =
  | { kind: 'affected'; affectedCount: number; uncertainCount: number }
  | { kind: 'uncertain'; uncertainCount: number }
  | { kind: 'clear' }
  | { kind: 'failed' }
  | { kind: 'not_analysed' };

function computeImpactState(repo: Repository): ImpactState {
  const { latestAnalysis } = repo;
  if (!latestAnalysis) return { kind: 'not_analysed' };
  if (latestAnalysis.status === 'failed') return { kind: 'failed' };
  const counts = countByStatus(latestAnalysis.latestImpactAssessments);
  if (counts.AFFECTED > 0) {
    return { kind: 'affected', affectedCount: counts.AFFECTED, uncertainCount: counts.UNCERTAIN };
  }
  if (counts.UNCERTAIN > 0) return { kind: 'uncertain', uncertainCount: counts.UNCERTAIN };
  return { kind: 'clear' };
}

/** Whether a repository's impact carries genuinely enumerable per-change
 * evidence (real `latestImpactAssessments` rows worth listing individually)
 * or is better communicated compressed. `clear` technically has assessment
 * rows too, but every one is `NOT_AFFECTED` -- nothing there earns a reader's
 * attention line by line, so it renders compressed like `failed`/`not_analysed`,
 * which have no assessment rows at all. */
function isReportWorthy(
  state: ImpactState,
): state is Extract<ImpactState, { kind: 'affected' | 'uncertain' }> {
  return state.kind === 'affected' || state.kind === 'uncertain';
}

const IMPACT_STATE_STYLE: Record<ImpactState['kind'], { dot: string; text: string }> = {
  affected: { dot: 'bg-mark-attention', text: 'text-attention' },
  uncertain: { dot: 'bg-mark-indeterminate', text: 'text-indeterminate' },
  clear: { dot: 'bg-mark-success', text: 'text-success' },
  failed: { dot: 'bg-mark-failure', text: 'text-failure' },
  not_analysed: { dot: 'bg-mark-neutral', text: 'text-fg-tertiary' },
};

function impactStateLabel(state: ImpactState): string {
  switch (state.kind) {
    case 'affected':
      return 'Affected';
    case 'uncertain':
      return 'Uncertain';
    case 'clear':
      return 'Clear';
    case 'failed':
      return 'Failed';
    case 'not_analysed':
      return 'Not analysed';
  }
}

/**
 * The one-sentence conclusion a repository's report block leads with --
 * the same real derivation `/analysis-runs/[id]` uses for its own impact
 * headline (a real count from `latestImpactAssessments`, not a fabricated
 * summary), adapted for a per-repository line rather than a per-run one.
 * Not imported from that page: two small, independently-evolving product
 * copy strings for two different screens don't yet justify a shared
 * module, and Analysis Detail's composition is out of scope for this
 * slice.
 */
function repositoryConclusion(state: ImpactState): string {
  switch (state.kind) {
    case 'affected': {
      const total = state.affectedCount;
      return `${total} change${total === 1 ? '' : 's'} affect${total === 1 ? 's' : ''} this repository`;
    }
    case 'uncertain': {
      const total = state.uncertainCount;
      return `${total} change${total === 1 ? '' : 's'} could not be confirmed`;
    }
    case 'clear':
      return 'No known impact';
    case 'failed':
      return 'Analysis failed';
    case 'not_analysed':
      return 'Awaiting first analysis';
  }
}

/**
 * Fixed, non-configurable priority -- no sort control, no user choice,
 * just a deliberate default order. At 2 repositories this is invisible;
 * at the 10-30 the product should scale to (per DESIGN.md Section 18),
 * an unordered list makes "which repository needs attention" a full
 * linear scan every visit, which directly undermines this page's whole
 * job (Section 33: index summarizes, scan -> identify attention -> act).
 * A fixed priority order is structural, not a "sorting feature."
 */
const IMPACT_STATE_PRIORITY: Record<ImpactState['kind'], number> = {
  affected: 0,
  uncertain: 1,
  failed: 2,
  not_analysed: 3,
  clear: 4,
};

/** Truthful page-level framing derived from the same collection the rows
 * render from -- never a separate/approximate count. Deliberately silent
 * about "no known impact" when the total includes `not_analysed`/`failed`
 * repositories: "no known impact" would overclaim for a repository that
 * simply hasn't been analysed yet. */
function pageSummary(states: ImpactState[]): string {
  const total = states.length;
  const repoWord = total === 1 ? 'repository' : 'repositories';
  const needsAttention = states.filter(isAttentionState).length;
  if (needsAttention === 0) return `${total} ${repoWord} under watch.`;
  const attentionWord = needsAttention === 1 ? 'needs' : 'need';
  return `${total} ${repoWord} under watch. ${needsAttention} ${attentionWord} attention.`;
}

function isAttentionState(state: ImpactState): boolean {
  return state.kind === 'affected' || state.kind === 'uncertain';
}

/** `startedAt`/`completedAt` are real, already-persisted fields the
 * previous revision of this page fetched but never rendered. Prefers
 * `completedAt` (when the run actually finished) over `startedAt`. Both
 * `completed` and `failed` runs are terminal writes with a real
 * `completedAt` (see DESIGN.md's note on `analysis_runs.status` having no
 * interim "running" value) -- `startedAt` is a defensive fallback only. */
function formatRelativeTime(startedAt: string, completedAt: string | null): string {
  const when = new Date(completedAt ?? startedAt).getTime();
  const diffMinutes = Math.round((when - Date.now()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  return rtf.format(Math.round(diffHours / 24), 'day');
}

/**
 * Analysis creation and impact assessment stay separate backend
 * capabilities (POST /repositories/:id/analyses, then POST
 * /analysis-runs/:id/impact-assessments) -- this only sequences the two
 * existing calls behind one button so the user sees a single coherent
 * action. If the second call fails, the AnalysisRun from the first call
 * is already persisted and stays; we redirect with an honest error
 * rather than implying the whole thing succeeded.
 */
async function analyseRepository(repositoryId: string) {
  'use server';

  const analyseResponse = await apiFetch(`/repositories/${repositoryId}/analyses`, {
    method: 'POST',
  });
  if (!analyseResponse.ok) {
    redirect('/repositories?error=analysis_failed');
  }
  const { analysisRun } = (await analyseResponse.json()) as { analysisRun: { id: string } };

  const impactResponse = await apiFetch(`/analysis-runs/${analysisRun.id}/impact-assessments`, {
    method: 'POST',
  });
  if (!impactResponse.ok) {
    redirect('/repositories?error=impact_assessment_failed');
  }

  redirect('/repositories');
}

function RepositoryIdentity({ repo }: { repo: Repository }) {
  return (
    <div className="min-w-0">
      <h2 className="break-words text-lg font-semibold tracking-tight text-fg">{repo.fullName}</h2>
      <p className="mt-1 text-xs text-fg-tertiary">
        {repo.isPrivate ? 'Private repository' : 'Public repository'}
      </p>
    </div>
  );
}

function RepositoryActions({
  hasReport,
  analysisRunId,
  repositoryId,
  everAnalysed,
}: {
  hasReport: boolean;
  analysisRunId: string | undefined;
  repositoryId: string;
  everAnalysed: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
      {hasReport && analysisRunId && (
        <Link href={`/analysis-runs/${analysisRunId}`} className={buttonVariantClassName.primary}>
          View impact report
        </Link>
      )}
      <form action={analyseRepository.bind(null, repositoryId)}>
        <FormSubmitButton
          label={everAnalysed ? 'Analyse again' : 'Analyse repository'}
          pendingLabel="Analysing…"
          variant={hasReport ? 'secondary' : 'primary'}
        />
      </form>
    </div>
  );
}

function StatusLabel({ state }: { state: ImpactState }) {
  const style = IMPACT_STATE_STYLE[state.kind];
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-semibold ${style.text}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
      {impactStateLabel(state)}
    </span>
  );
}

function SnapshotContext({ repo }: { repo: Repository }) {
  const { latestAnalysis } = repo;
  const items = [
    { label: 'Branch', value: repo.defaultBranch },
    ...(latestAnalysis?.stripe
      ? [
          {
            label: 'Stripe SDK',
            value: latestAnalysis.stripe.resolvedVersion ?? latestAnalysis.stripe.declaredRange,
          },
        ]
      : []),
    ...(latestAnalysis
      ? [
          { label: 'Snapshot', value: latestAnalysis.commitSha.slice(0, 7) },
          {
            label: 'Analysed',
            value: formatRelativeTime(latestAnalysis.startedAt, latestAnalysis.completedAt),
          },
        ]
      : []),
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 sm:gap-y-0">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-2xs font-semibold text-fg-tertiary">{item.label}</dt>
          <dd className="mt-1 truncate font-mono text-xs text-fg-secondary" title={item.value}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ProviderChanges({ assessments }: { assessments: LatestImpactAssessment[] }) {
  const changes = [...assessments]
    .filter((assessment) => assessment.status !== 'NOT_AFFECTED')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'AFFECTED' ? -1 : 1));

  return (
    <section aria-label="Provider changes" className="border-t border-rule">
      <div className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:px-6">
        <h3 className="text-sm font-semibold text-fg">Provider changes</h3>
        <p className="text-xs leading-5 text-fg-tertiary">
          {changes.length} change{changes.length === 1 ? '' : 's'} require attention
        </p>
      </div>

      <ol className="border-t border-rule">
        {changes.map((change) => {
          const affected = change.status === 'AFFECTED';
          const changeStyle = IMPACT_STATE_STYLE[affected ? 'affected' : 'uncertain'];
          return (
            <li
              key={`${change.status}-${change.providerChangeTitle}`}
              className="grid gap-3 border-b border-rule px-5 py-4 last:border-b-0 sm:px-6 md:grid-cols-[minmax(0,1fr)_9rem] md:items-center md:gap-6"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${changeStyle.dot}`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-5 text-fg-secondary">
                    {change.providerChangeTitle}
                  </p>
                  <p className={`mt-1 text-xs font-medium ${changeStyle.text}`}>
                    {affected ? 'Affected' : 'Uncertain'}
                  </p>
                </div>
              </div>
              {affected && change.findings.length > 0 ? (
                <p className="font-mono text-2xs leading-5 text-fg-tertiary md:text-right">
                  {change.findings.length} confirmed usage
                  {change.findings.length === 1 ? '' : 's'}
                </p>
              ) : (
                <span aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RepositoryLedger({ repo, state }: { repo: Repository; state: ImpactState }) {
  const { latestAnalysis } = repo;
  const hasReport = latestAnalysis !== null && latestAnalysis.status === 'completed';
  const isExpanded = isReportWorthy(state);

  return (
    <article className="overflow-hidden rounded-md border border-rule bg-canvas focus-within:border-rule-strong">
      <header className="grid gap-4 bg-surface px-5 py-4 sm:grid-cols-[minmax(6rem,0.7fr)_minmax(9rem,1.3fr)_max-content] sm:items-center sm:gap-3 sm:px-6">
        <RepositoryIdentity repo={repo} />

        <div className="min-w-0">
          <StatusLabel state={state} />
          <p className="mt-1.5 text-xl font-semibold leading-7 tracking-tight text-fg">
            {repositoryConclusion(state)}
          </p>
        </div>

        <RepositoryActions
          hasReport={hasReport}
          analysisRunId={latestAnalysis?.analysisRunId}
          repositoryId={repo.id}
          everAnalysed={latestAnalysis !== null}
        />
      </header>

      <div className="border-t border-rule px-5 py-4 sm:px-6">
        <SnapshotContext repo={repo} />
      </div>

      {isExpanded && latestAnalysis && (
        <ProviderChanges assessments={latestAnalysis.latestImpactAssessments} />
      )}
    </article>
  );
}

export default async function RepositoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const reposResponse = await apiFetch('/repositories');
  const { repositories } = reposResponse.ok
    ? ((await reposResponse.json()) as { repositories: Repository[] })
    : { repositories: [] };

  if (repositories.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            Connect your first repository
          </h1>
          <p className="text-sm leading-6 text-fg-tertiary">
            Patchwork needs access only to repositories you explicitly select.
          </p>
        </div>

        <ErrorBanner code={error} />

        <a
          href={`${API_URL}/github/install`}
          className="inline-flex items-center justify-center rounded-md bg-accent-strong px-5 py-2.5 text-sm font-medium text-accent-strong-fg transition-colors hover:bg-accent-strong-hover"
        >
          Select repositories on GitHub
        </a>
      </main>
    );
  }

  const withState = repositories.map((repo) => ({ repo, state: computeImpactState(repo) }));
  const ordered = [...withState].sort(
    (a, b) => IMPACT_STATE_PRIORITY[a.state.kind] - IMPACT_STATE_PRIORITY[b.state.kind],
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-7 px-4 pt-10 pb-16 sm:px-6 lg:pt-12">
      <div className="border-b border-rule pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-fg">Repositories</h1>
        <p className="mt-2 text-sm leading-6 text-fg-tertiary">
          {pageSummary(ordered.map((r) => r.state))}
        </p>
      </div>

      <ErrorBanner code={error} />

      <div className="flex flex-col gap-4">
        {ordered.map(({ repo, state }) => (
          <RepositoryLedger key={repo.id} repo={repo} state={state} />
        ))}
      </div>
    </main>
  );
}
