import { Fragment } from 'react';
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
 * The count fragment that answers "how much?" beside the status label.
 * Only the two states that have real per-change counts get one -- `clear`,
 * `failed` and `not_analysed` are fully carried by their status label. This
 * replaced a per-record headline that rendered a conclusion sentence for
 * every state ("No known impact", "Analysis failed", "Awaiting first
 * analysis"); on an index row each of those restates its own status label at
 * the cost of a 28px line on every repository in the estate, and the next
 * step for the two that have one is already the button beside it.
 */
function impactCounts(state: ImpactState): string | null {
  switch (state.kind) {
    case 'affected':
      return state.uncertainCount > 0
        ? `${state.affectedCount} affected · ${state.uncertainCount} uncertain`
        : `${state.affectedCount} affected`;
    case 'uncertain':
      return `${state.uncertainCount} uncertain`;
    default:
      return null;
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

/**
 * `owner/name` with the owner de-emphasised. Every row on this page
 * usually shares one owner, so rendering `fullName` at a single weight
 * makes twenty rows begin with the same twenty identical characters --
 * the part that actually distinguishes one row from another is the
 * repository name, and that is what the scan should land on. Both halves
 * are real DTO fields, not a parsed string.
 */
function RepositoryIdentity({ repo }: { repo: Repository }) {
  return (
    <h2 className="min-w-0 truncate text-sm leading-5 font-semibold tracking-tight text-fg">
      <span className="font-normal text-fg-tertiary">{repo.owner}/</span>
      {repo.name}
    </h2>
  );
}

/**
 * The snapshot facts that used to occupy their own 70px four-column `<dl>`
 * region under every record, inlined as one wrapping metadata line. At
 * index density these are orientation, not evidence -- the reader needs
 * "which commit, which SDK, how fresh" to trust the verdict beside it, and
 * a labelled definition list per row costs more vertical space than the
 * facts are worth. Every value is a real field; nothing is shown for a
 * repository that has not been analysed except what is known about the
 * repository itself.
 */
function RepositoryMeta({ repo }: { repo: Repository }) {
  const { latestAnalysis } = repo;
  const parts = [
    repo.isPrivate ? 'Private' : 'Public',
    repo.defaultBranch,
    ...(latestAnalysis?.stripe
      ? [`stripe ${latestAnalysis.stripe.resolvedVersion ?? latestAnalysis.stripe.declaredRange}`]
      : []),
    ...(latestAnalysis
      ? [
          latestAnalysis.commitSha.slice(0, 7),
          `analysed ${formatRelativeTime(latestAnalysis.startedAt, latestAnalysis.completedAt)}`,
        ]
      : []),
  ];

  return (
    <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-2xs leading-4 text-fg-tertiary">
      {parts.map((part, index) => (
        <Fragment key={part}>
          {index > 0 && (
            <span aria-hidden="true" className="text-fg-faint">
              ·
            </span>
          )}
          <span className="truncate">{part}</span>
        </Fragment>
      ))}
    </p>
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
    // `flex-wrap` only below `md`, where the region is stacked and genuinely
    // may need two lines. From `md` up it is a fixed-width grid column, and a
    // wrapping flex container there is the failure mode this row was fixed
    // for: it reflows onto a second line the moment the available width is a
    // fraction of a pixel short, which turns a 105px row into a 149px one.
    <div className="flex shrink-0 flex-wrap items-center gap-2 md:flex-nowrap md:justify-end">
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
  const counts = impactCounts(state);
  return (
    <div className="min-w-0">
      <span className={`inline-flex items-center gap-2 text-xs font-semibold ${style.text}`}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        {impactStateLabel(state)}
      </span>
      {counts && (
        <p className="mt-1 truncate font-mono text-2xs leading-4 text-fg-secondary">{counts}</p>
      )}
    </div>
  );
}

/**
 * The index's answer to "why does this repository need attention?" -- one
 * line per real provider change, collapsed behind a native disclosure.
 *
 * Deliberately one line, not the two-line status-beneath-title row this
 * previously rendered: at index density the change's own status is already
 * implied by its position (affected first, and the usage count only exists
 * for a confirmed one), and the second line cost ~73px per change, which
 * made a four-change repository 346px tall -- 68% of the whole record, for
 * content Section 33 reserves for the detail screen. Still real
 * `providerChangeTitle` plus a real findings count and nothing else: no
 * `reason` sentence, no `file:line`, no row-level actions.
 */
function ImpactPreview({ assessments }: { assessments: LatestImpactAssessment[] }) {
  const changes = [...assessments]
    .filter((assessment) => assessment.status !== 'NOT_AFFECTED')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'AFFECTED' ? -1 : 1));

  if (changes.length === 0) return null;

  return (
    // `name` groups every row's disclosure into one native exclusive
    // accordion: opening a second preview closes the first, so the list
    // cannot silently grow past a screen as the reader works down it. It
    // is a browser primitive -- no JS, no client component, no accordion
    // state to keep in sync -- and where it is unsupported the disclosures
    // simply stay independent rather than breaking.
    <details name="repository-impact-preview" className="group min-w-0 max-w-3xl">
      <summary className="inline-flex w-fit cursor-pointer list-none items-center rounded-sm text-xs font-medium text-fg-tertiary hover:text-fg-secondary focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none">
        <span className="group-open:hidden">
          Show {changes.length} change{changes.length === 1 ? '' : 's'}
        </span>
        <span className="hidden group-open:inline">Hide changes</span>
      </summary>

      <ul className="mt-2 flex min-w-0 flex-col gap-1.5 border-l border-rule pl-3">
        {changes.map((change) => {
          const affected = change.status === 'AFFECTED';
          return (
            <li
              key={`${change.status}-${change.providerChangeTitle}`}
              className="flex min-w-0 items-baseline justify-between gap-4 text-2xs leading-4"
            >
              {/* Wraps rather than truncates: the preview is opt-in, so its
                  vertical cost is only paid when the reader asked for it, and
                  at narrow widths a truncated change title has no hover
                  tooltip to fall back on. */}
              <span className="min-w-0 text-fg-secondary">{change.providerChangeTitle}</span>
              <span
                className={`shrink-0 font-mono ${affected ? 'text-fg-tertiary' : IMPACT_STATE_STYLE.uncertain.text}`}
              >
                {affected
                  ? `${change.findings.length} usage${change.findings.length === 1 ? '' : 's'}`
                  : 'Uncertain'}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * One repository as one index row.
 *
 * This replaced a per-repository bordered record containing three stacked
 * regions (header, snapshot rail, provider-change register). That shape
 * read well at two repositories and stopped scaling well before twenty:
 * measured, an affected record was 508px and a clear one 162px, so twenty
 * repositories produced a 5,668px page and pushed the last
 * attention-needing repository to 3,189px -- three and a half screens down
 * a list that is already sorted attention-first, which defeats the point
 * of sorting it. See DESIGN.md Section 18.
 *
 * The three regions are now one aligned three-column row plus an optional
 * collapsed preview, so every row costs roughly one screen-line and the
 * columns line up across the whole estate.
 *
 * The two right-hand tracks are explicit widths, deliberately not
 * `minmax(9rem,max-content)` / `max-content`, for two reasons that are the
 * same reason:
 *
 *   1. Every `<li>` is its own grid, so an intrinsic track is measured
 *      per row. Rows with one button sized that track at 110px and rows
 *      with two at 257px, which put the status column at four different x
 *      positions down a twenty-row list -- the columns did not actually
 *      align, which is the whole point of a ledger.
 *   2. An intrinsic track is engine-measured. Chromium and WebKit size the
 *      identical actions content at 264.08px and 252.78px respectively, and
 *      the container inside it wrapped (`flex-wrap`), so a fractional
 *      shortfall in that measurement reflowed the second button onto its own
 *      line and doubled the row's height. A fixed track cannot be
 *      under-measured, and `md:flex-nowrap` means it could not reflow even
 *      if it were.
 *
 * 17rem clears the widest real actions content (a 257px "View impact
 * report" + "Analyse again" pair) with headroom, and 11rem clears the
 * widest real status content (a 158px "N affected · N uncertain"). If
 * either ever overflows, the content wraps inside its own fixed track --
 * the row grows slightly and the collection stays aligned, instead of one
 * row silently widening its column and shunting every neighbour.
 *
 * The row layout starts at `md`, not `sm`: those two tracks plus their gaps
 * need 480px, which would leave ~120px for repository identity in a 640px
 * viewport. Below `md` the regions stack, which is what "the viewport
 * genuinely cannot support it" looks like.
 */
function RepositoryRow({ repo, state }: { repo: Repository; state: ImpactState }) {
  const { latestAnalysis } = repo;
  const hasReport = latestAnalysis !== null && latestAnalysis.status === 'completed';

  return (
    // No hover tint: the row is not a click target (the action beside it
    // is), and tinting it on hover would imply otherwise -- the same reason
    // Section 18 keeps provider-change rows visually static. `focus-within`
    // is different: it orients a keyboard user to which row they are in.
    // Deliberately not transitioned, so the tint can never lag behind the
    // focus that caused it.
    <li className="grid gap-x-6 gap-y-2 px-4 py-3.5 focus-within:bg-surface-hover md:grid-cols-[minmax(0,1fr)_11rem_17rem] md:items-start md:px-5">
      <div className="min-w-0">
        <RepositoryIdentity repo={repo} />
        <RepositoryMeta repo={repo} />
      </div>

      <StatusLabel state={state} />

      <RepositoryActions
        hasReport={hasReport}
        analysisRunId={latestAnalysis?.analysisRunId}
        repositoryId={repo.id}
        everAnalysed={latestAnalysis !== null}
      />

      {/* Last in DOM order, spanning the row: the preview explains the
          verdict, so it has to be read after it, not before. Nesting it in
          the identity column put the collapsed change list ahead of the
          status label for a screen reader and squeezed long change titles
          into the narrowest column. */}
      {isReportWorthy(state) && latestAnalysis && (
        <div className="min-w-0 md:col-span-3">
          <ImpactPreview assessments={latestAnalysis.latestImpactAssessments} />
        </div>
      )}
    </li>
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

      {/* One bordered collection with divided rows, not one bordered card per
          repository (DESIGN.md Section 12: a list of repeated items is
          separated by `divide-y`, not by wrapping each item in its own
          card). At twenty repositories twenty separate boundaries is twenty
          things to visually parse before reading any of them; one boundary
          around one ledger is the index's real shape. */}
      <ol className="divide-y divide-rule overflow-hidden rounded-md border border-rule">
        {ordered.map(({ repo, state }) => (
          <RepositoryRow key={repo.id} repo={repo} state={state} />
        ))}
      </ol>
    </main>
  );
}
