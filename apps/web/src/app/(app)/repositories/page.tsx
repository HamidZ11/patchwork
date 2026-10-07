import Link from 'next/link';
import { ArrowRight, Lock, X } from 'lucide-react';
import { buttonVariantClassName } from '@/components/button-styles';
import { ErrorBanner } from '@/components/error-banner';
import { apiFetch, API_URL } from '@/lib/api';
import { analyseRepository } from './actions';
import { AnalyseButton } from './analyse-button';
import { PatchGlyph } from './patch-glyph';
import { PAGE_GRID, PAGE_MAIN as MAIN, Section } from './section';
import {
  buildRepositoryIndex,
  filterRows,
  indexHref,
  latestAnalysis,
  parseChange,
  parseView,
  verdictDetail,
  type IndexRow,
  type IndexView,
  type RepositoryIndex,
  type TrackedChange,
} from './repository-index';
import {
  IMPACT_STATE_LABEL,
  type AssessmentStatus,
  type ImpactStateKind,
  type Repository,
} from './repository-state';

/**
 * The repository index (DESIGN.md Amendment B5).
 *
 * A main column and a context sidebar. The main column opens with a summary
 * strip that is also the view filter, then holds up to three sections with
 * their own density: repositories that need a decision get roomy rows and
 * the change matrix -- the only rows where it carries information -- while
 * repositories awaiting analysis and clear repositories collapse to single
 * lines. The sidebar lists the tracked Stripe changes the matrix columns
 * refer to; each one, like each matrix column, narrows the list to the
 * repositories that change hits.
 *
 * Every filter lives in the URL (`?view=`, `?change=`), so every filter is a
 * plain link: shareable, back-button safe, and server-rendered.
 *
 * Text is spent only where it decides something. Owner, branch and commit
 * live on the repository overview, not on every row.
 */

const VERDICT_TONE: Record<ImpactStateKind, string> = {
  affected: 'text-attention',
  uncertain: 'text-indeterminate',
  failed: 'text-failure',
  clear: 'text-fg-secondary',
  not_assessed: 'text-fg-secondary',
  not_analysed: 'text-fg-tertiary',
};

const CELL_LABEL: Record<AssessmentStatus, string> = {
  AFFECTED: 'Affected',
  UNCERTAIN: 'Uncertain',
  NOT_AFFECTED: 'Not affected',
};

function cellLabel(status: AssessmentStatus | null): string {
  return status ? CELL_LABEL[status] : 'Not assessed';
}

/** Colour only where a cell carries a finding: faint tints with their mark
 * for affected and uncertain, a quiet block with a neutral dot for checked
 * and clean, the faintest empty block for no assessment. */
const CELL_STYLE: Record<AssessmentStatus | 'NONE', string> = {
  AFFECTED: 'bg-mark-attention/15 font-semibold text-attention',
  UNCERTAIN: 'bg-mark-indeterminate/15 font-semibold text-indeterminate',
  NOT_AFFECTED: 'bg-surface text-mark-neutral',
  NONE: 'bg-surface-hover',
};

/** Every section ends in the same two fixed tracks, so analysed times and
 * actions line up down the whole page whatever sits before them. */
const TAIL = 'md:[grid-template-columns:1rem_minmax(0,1fr)_var(--mid,0px)_6.5rem_6.5rem]';

const ROW =
  'group relative grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-4 px-5 transition-colors duration-100';

/** Where a matrix column or legend entry leads: that change's repositories.
 * The view is kept when it can still contain them -- a change only ever
 * hits repositories that need attention -- and selecting the current
 * change again clears it. */
function changeHref(view: IndexView, change: TrackedChange, selected: TrackedChange | null) {
  if (selected?.title === change.title) return indexHref(view, null);
  return indexHref(view === 'attention' ? view : 'all', change);
}

interface Filter {
  view: IndexView;
  change: TrackedChange | null;
}

/** One cell: a link to its change's filter, above the row link (`z-10`).
 * Pointer-only (`tabIndex -1`, hidden from assistive tech): keyboard and
 * screen-reader users reach the same filter from the sidebar, and hear the
 * row's matrix from its sr-only summary. */
function MatrixCell({
  row,
  change,
  filter,
}: {
  row: IndexRow;
  change: TrackedChange;
  filter: Filter;
}) {
  const { status, usages } = row.cells[change.index] ?? { status: null, usages: null };
  const selected = filter.change?.title === change.title;
  const tip =
    status === 'AFFECTED'
      ? `${change.label} · Affected · ${usages} ${usages === 1 ? 'usage' : 'usages'}`
      : `${change.label} · ${cellLabel(status)}`;
  return (
    <Link
      href={changeHref(filter.view, change, filter.change)}
      tabIndex={-1}
      aria-hidden="true"
      data-col={change.index}
      data-selected={selected || undefined}
      className={`group/cell relative z-10 grid size-6 place-items-center rounded-sm font-mono text-2xs leading-none data-selected:outline data-selected:outline-1 data-selected:outline-offset-1 data-selected:outline-fg-tertiary ${CELL_STYLE[status ?? 'NONE']}`}
    >
      {status === 'AFFECTED' ? (
        usages
      ) : status === 'UNCERTAIN' ? (
        '?'
      ) : status === 'NOT_AFFECTED' ? (
        <span className="size-1 rounded-full bg-current" />
      ) : null}
      <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 scale-95 rounded-chip bg-raised px-2 py-1 font-sans text-xs font-normal whitespace-nowrap text-fg opacity-0 shadow-overlay transition-[opacity,scale] duration-150 ease-out-strong group-hover/cell:scale-100 group-hover/cell:opacity-100 group-hover/cell:delay-100 motion-reduce:scale-100">
        {tip}
      </span>
    </Link>
  );
}

function RepoLink({ row, showOwner }: { row: IndexRow; showOwner: boolean }) {
  return (
    <Link
      href={row.href}
      title={row.fullName}
      className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-fg after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus focus-visible:after:ring-inset"
    >
      <span className="truncate">
        {showOwner && <span className="font-normal text-fg-tertiary">{row.owner} / </span>}
        {row.name}
      </span>
      {row.isPrivate && (
        <>
          <Lock aria-hidden="true" className="size-3 shrink-0 text-fg-tertiary" />
          <span className="sr-only">{' (private)'}</span>
        </>
      )}
    </Link>
  );
}

function When({ row, className = '' }: { row: IndexRow; className?: string }) {
  return row.analysed ? (
    <time dateTime={row.analysed.iso} title={row.analysed.absolute} className={className}>
      {row.analysed.relative}
    </time>
  ) : (
    <span className={className}>Never</span>
  );
}

function AnalyseForm({ row }: { row: IndexRow }) {
  const intent =
    row.state.kind === 'clear'
      ? 'reanalyse'
      : row.state.kind === 'not_analysed'
        ? 'analyse'
        : 'retry';
  return (
    // Unfilled controls are pulled out by their own padding so their visible
    // edge lines up with the filled Review buttons. Layered above the row
    // link (`z-10`), never nested inside it.
    <form action={analyseRepository.bind(null, row.id, 'index')} className="relative z-10 -mr-2">
      <AnalyseButton intent={intent} repositoryName={row.fullName} />
    </form>
  );
}

/** A repository that needs a decision: roomy, with what it is affected by
 * and the matrix. "Review" is the visible end of the row link. */
function AttentionRow({
  row,
  changes,
  filter,
  showOwner,
}: {
  row: IndexRow;
  changes: TrackedChange[];
  filter: Filter;
  showOwner: boolean;
}) {
  return (
    <li
      className={`${ROW} py-4 hover:bg-raised-hover ${TAIL}`}
      style={{ ['--mid' as string]: 'auto' }}
    >
      <span className="row-span-2 self-start pt-0.5 md:row-span-1 md:self-center md:pt-0">
        <PatchGlyph kind={row.state.kind} />
      </span>
      <div className="min-w-0">
        <RepoLink row={row} showOwner={showOwner} />
        {/* One truncating line beside the matrix; below `md` the detail
            wraps instead, and the analysed time takes its own line. */}
        <p className="mt-1 min-w-0 text-ui md:flex md:items-baseline md:gap-1.5">
          <span className={`font-medium ${VERDICT_TONE[row.state.kind]}`}>
            {IMPACT_STATE_LABEL[row.state.kind]}
          </span>{' '}
          <span className="text-fg-tertiary tabular-nums md:truncate">{verdictDetail(row)}</span>
        </p>
        <When row={row} className="mt-0.5 block text-xs text-fg-tertiary md:hidden" />
      </div>
      <div className="hidden gap-1.5 md:flex">
        {changes.map((change) => (
          <MatrixCell key={change.title} row={row} change={change} filter={filter} />
        ))}
        <span className="sr-only">
          {changes
            .map(
              (c) =>
                `Change ${c.label}: ${cellLabel(row.cells[c.index]?.status ?? null).toLowerCase()}`,
            )
            .join('; ')}
        </span>
      </div>
      <When row={row} className="hidden text-ui text-fg-tertiary tabular-nums md:block" />
      <div className="col-start-3 row-span-2 row-start-1 flex justify-end md:col-start-auto md:row-span-1 md:row-start-auto">
        <span
          aria-hidden="true"
          className="inline-flex h-7 items-center gap-1 rounded-control bg-surface pr-2 pl-2.5 text-ui font-medium text-fg shadow-btn transition-colors duration-100 group-hover:bg-evidence"
        >
          Review
          <ArrowRight className="size-3.5 text-fg-secondary transition-[translate,color] duration-150 ease-out-strong group-hover:translate-x-0.5 group-hover:text-fg motion-reduce:group-hover:translate-x-0" />
        </span>
      </div>
    </li>
  );
}

/** One line: failed, not assessed and never-analysed repositories differ
 * only in their status word and the action that runs the analysis. */
function PendingRow({ row, showOwner }: { row: IndexRow; showOwner: boolean }) {
  return (
    <li
      className={`${ROW} py-3 hover:bg-surface-hover ${TAIL}`}
      style={{ ['--mid' as string]: '9rem' }}
    >
      <PatchGlyph kind={row.state.kind} />
      <div className="min-w-0">
        <RepoLink row={row} showOwner={showOwner} />
        <p className="mt-0.5 text-ui text-fg-tertiary md:hidden">
          <span className={VERDICT_TONE[row.state.kind]}>{IMPACT_STATE_LABEL[row.state.kind]}</span>
          {row.analysed && (
            <>
              <span aria-hidden="true"> · </span>
              <When row={row} />
            </>
          )}
        </p>
      </div>
      <span className={`hidden text-ui md:block ${VERDICT_TONE[row.state.kind]}`}>
        {IMPACT_STATE_LABEL[row.state.kind]}
      </span>
      <When row={row} className="hidden text-ui text-fg-tertiary tabular-nums md:block" />
      <div className="flex justify-end">
        <AnalyseForm row={row} />
      </div>
    </li>
  );
}

/** One line, no status word: the section heading already says "Clear". */
function ClearRow({ row, showOwner }: { row: IndexRow; showOwner: boolean }) {
  return (
    <li className={`${ROW} py-3 hover:bg-surface-hover ${TAIL}`}>
      <PatchGlyph kind={row.state.kind} />
      <div className="min-w-0">
        <RepoLink row={row} showOwner={showOwner} />
        <When row={row} className="mt-0.5 block text-ui text-fg-tertiary md:hidden" />
      </div>
      <span className="hidden md:block" />
      <When row={row} className="hidden text-ui text-fg-tertiary tabular-nums md:block" />
      <div className="flex justify-end">
        <AnalyseForm row={row} />
      </div>
    </li>
  );
}

/** The tracked changes, which double as the matrix legend and the change
 * filter. Two lines per change instead of a truncated one; hovering an
 * entry outlines its column in the list, selecting it narrows the list. */
function TrackedChanges({ changes, filter }: { changes: TrackedChange[]; filter: Filter }) {
  return (
    <section aria-labelledby="tracked-changes">
      <h2 id="tracked-changes" className="flex h-5 items-center gap-2 text-ui font-medium text-fg">
        Tracked changes
        <span className="rounded-chip bg-surface px-1.5 py-px font-mono text-2xs font-normal text-fg-secondary shadow-hairline">
          stripe-node
        </span>
      </h2>
      {changes.length === 0 ? (
        <p className="mt-3 text-ui text-fg-tertiary">
          Nothing has been assessed yet. Analyse a repository to see what it is checked against.
        </p>
      ) : (
        <ol className="-mx-2 mt-3 space-y-0.5">
          {changes.map((c) => {
            const selected = filter.change?.title === c.title;
            return (
              <li key={c.title}>
                <Link
                  href={changeHref(filter.view, c, filter.change)}
                  aria-current={selected ? 'true' : undefined}
                  data-col={c.index}
                  data-legend={c.index}
                  className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 rounded-control px-2 py-2 transition-[opacity,background-color] duration-100 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none aria-[current=true]:bg-surface aria-[current=true]:shadow-btn"
                >
                  <span className="font-mono text-2xs leading-5 text-fg-tertiary">{c.label}</span>
                  <span className="line-clamp-2 text-ui [overflow-wrap:anywhere] text-fg-secondary">
                    {c.title}
                  </span>
                  <span className="col-start-2 mt-1 text-xs text-fg-tertiary tabular-nums">
                    {changeImpact(c)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** What a change hits across the assessed estate. "None affected" only
 * when it was assessed somewhere and confirmed nowhere, and left nothing
 * unresolved either. */
function changeImpact(c: TrackedChange): string {
  return (
    [
      c.affectedRepos > 0 && `${c.affectedRepos} affected`,
      c.uncertainRepos > 0 && `${c.uncertainRepos} uncertain`,
    ]
      .filter(Boolean)
      .join(' · ') || 'None affected'
  );
}

type Part = { text: string; mark: string };

const MARK = {
  attention: 'bg-mark-attention',
  indeterminate: 'bg-mark-indeterminate',
  failure: 'bg-mark-failure',
  success: 'bg-mark-success',
  neutral: 'ring-1 ring-mark-neutral ring-inset',
};

/** The short breakdown under each summary count. Each part names exactly
 * the verdicts behind the number. */
function summaryParts(view: IndexView, index: RepositoryIndex): Part[] | string {
  const { counts } = index;
  switch (view) {
    case 'all': {
      const latest = latestAnalysis(index.rows);
      return latest ? `Last analysed ${latest.relative}` : 'Never analysed';
    }
    case 'attention':
      return [
        counts.affected > 0 && { text: `${counts.affected} affected`, mark: MARK.attention },
        counts.uncertain > 0 && { text: `${counts.uncertain} uncertain`, mark: MARK.indeterminate },
      ].filter((p): p is Part => Boolean(p));
    case 'pending': {
      // Not assessed and never analysed have the same gap -- no assessment
      // -- so only a failure is called out on its own.
      const unassessed = counts.not_assessed + counts.not_analysed;
      return [
        counts.failed > 0 && { text: `${counts.failed} failed`, mark: MARK.failure },
        unassessed > 0 && { text: `${unassessed} unassessed`, mark: MARK.neutral },
      ].filter((p): p is Part => Boolean(p));
    }
    case 'clear':
      return counts.clear > 0 ? [{ text: 'Not affected', mark: MARK.success }] : [];
  }
}

const VIEWS: { view: IndexView; label: string }[] = [
  { view: 'all', label: 'All repositories' },
  { view: 'attention', label: 'Needs attention' },
  { view: 'pending', label: 'Needs analysis' },
  { view: 'clear', label: 'Clear' },
];

/** The estate at a glance, and the view filter: each count is a link to
 * the repositories behind it. Selecting a view drops a change filter. */
function SummaryStrip({ index, view }: { index: RepositoryIndex; view: IndexView }) {
  return (
    <nav aria-label="Filter repositories">
      <ul className="grid grid-cols-2 overflow-hidden rounded-window bg-panel shadow-card md:grid-cols-4">
        {VIEWS.map((v, i) => {
          const count = v.view === 'all' ? index.rows.length : index.groupCounts[v.view];
          const parts = summaryParts(v.view, index);
          return (
            <li
              key={v.view}
              className={`border-rule ${i % 2 === 1 ? 'border-l' : ''} ${i < 2 ? 'max-md:border-b' : ''} ${i === 2 ? 'md:border-l' : ''}`}
            >
              <Link
                href={indexHref(v.view, null)}
                aria-current={v.view === view ? 'page' : undefined}
                className="group flex h-full flex-col px-5 pt-4 pb-3.5 transition-colors duration-100 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none focus-visible:ring-inset aria-[current=page]:bg-surface"
              >
                <span className="text-ui text-fg-secondary group-aria-[current=page]:text-fg">
                  {v.label}
                </span>
                <span className="mt-1.5 text-xl leading-7 font-semibold tracking-[-0.01em] text-fg tabular-nums">
                  {count}
                </span>
                <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-fg-tertiary tabular-nums">
                  {typeof parts === 'string'
                    ? parts
                    : parts.length === 0
                      ? 'None'
                      : parts.map((p) => (
                          <span
                            key={p.text}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <span
                              aria-hidden="true"
                              className={`size-1.5 rounded-full ${p.mark}`}
                            />
                            {p.text}
                          </span>
                        ))}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The active change filter, with the way out of it. The chip takes the
 * room it needs and truncates the title; the impact count never wraps
 * away from it. */
function ChangeFilter({ change, view }: { change: TrackedChange; view: IndexView }) {
  return (
    <div className="flex min-w-0 items-center gap-3 text-ui">
      <span className="inline-flex h-7 min-w-0 items-center gap-2 rounded-control bg-surface pr-1 pl-2.5 shadow-btn">
        <span className="shrink-0 text-fg-tertiary">Hit by</span>
        <span className="shrink-0 font-mono text-2xs text-fg-tertiary">{change.label}</span>
        <span className="truncate text-fg">{change.title}</span>
        <Link
          href={indexHref(view, null)}
          className="grid size-5 shrink-0 place-items-center rounded-chip text-fg-tertiary transition-colors duration-100 hover:bg-evidence hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          <X aria-hidden="true" className="size-3.5" />
          <span className="sr-only">Clear change filter</span>
        </Link>
      </span>
      <span className="shrink-0 text-fg-tertiary tabular-nums">{changeImpact(change)}</span>
    </div>
  );
}

const EMPTY_VIEW: Record<IndexView, string> = {
  all: 'No repositories.',
  attention: 'No repository has an affected or uncertain verdict.',
  pending: 'Every repository has a verdict.',
  clear: 'No repository is clear yet.',
};

export default async function RepositoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; view?: string | string[]; change?: string | string[] }>;
}) {
  const params = await searchParams;
  const { error } = params;
  const one = (value: string | string[] | undefined) =>
    typeof value === 'string' ? value : undefined;

  const reposResponse = await apiFetch('/repositories');

  // A failed list request is not an empty estate: saying "connect your first
  // repository" here would claim something the API never said.
  if (!reposResponse.ok) {
    return (
      <main className={MAIN}>
        <h1 className="text-title font-semibold tracking-[-0.02em] text-fg">Repositories</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          Repositories could not be loaded. The Patchwork API returned {reposResponse.status};
          reload to try again.
        </p>
      </main>
    );
  }

  const { repositories } = (await reposResponse.json()) as { repositories: Repository[] };

  if (repositories.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
        <div className="flex max-w-md flex-col items-center gap-2 text-center">
          <h1 className="text-title font-semibold tracking-[-0.02em] text-fg">
            Connect your first repository
          </h1>
          <p className="text-sm text-fg-secondary">
            Patchwork needs access only to repositories you explicitly select.
          </p>
        </div>
        <ErrorBanner code={error} />
        <a href={`${API_URL}/github/install`} className={buttonVariantClassName.primary}>
          Select repositories on GitHub
        </a>
      </main>
    );
  }

  const index = buildRepositoryIndex(repositories);
  const owners = new Set(index.rows.map((row) => row.owner));
  // The owner is only worth repeating when it actually varies.
  const showOwner = owners.size > 1;
  const total = index.rows.length;
  // An unknown view or change in the URL is ignored, never guessed at.
  const filter: Filter = {
    view: parseView(one(params.view)),
    change: parseChange(one(params.change), index.changes),
  };
  const visible = filterRows(index.rows, filter.view, filter.change);
  const attention = visible.filter((row) => row.group === 'attention');
  const pending = visible.filter((row) => row.group === 'pending');
  const clear = visible.filter((row) => row.group === 'clear');

  return (
    <main className={`matrix-scope ${MAIN}`}>
      <header>
        <h1 className="text-title font-semibold tracking-[-0.02em] text-fg">Repositories</h1>
        <p className="mt-1.5 text-sm text-fg-tertiary">
          {showOwner ? '' : `${[...owners][0]} · `}
          {total} {total === 1 ? 'repository' : 'repositories'} watched for Stripe API changes
        </p>
      </header>

      {error && (
        <div className="mt-6">
          <ErrorBanner code={error} />
        </div>
      )}

      <div className={PAGE_GRID}>
        <div className="flex min-w-0 flex-col gap-10">
          <div className="flex flex-col gap-5">
            <SummaryStrip index={index} view={filter.view} />
            {filter.change && <ChangeFilter change={filter.change} view={filter.view} />}
          </div>

          {visible.length === 0 && (
            <div className="rounded-window bg-panel px-5 py-10 text-center shadow-card">
              <p className="text-ui text-fg-secondary">
                {!filter.change
                  ? EMPTY_VIEW[filter.view]
                  : filter.view === 'all'
                    ? 'No repository is affected by or uncertain on this change.'
                    : 'No repository in this view is affected by or uncertain on this change.'}
              </p>
              <Link
                href={indexHref('all', null)}
                className={`${buttonVariantClassName.secondary} mt-4`}
              >
                Show all repositories
              </Link>
            </div>
          )}

          {attention.length > 0 && (
            <Section id="needs-attention" title="Needs attention" count={attention.length}>
              <div
                aria-hidden="true"
                className={`hidden h-9 items-center gap-x-4 border-b border-rule px-5 text-xs text-fg-tertiary md:grid ${TAIL}`}
                style={{ ['--mid' as string]: 'auto' }}
              >
                <span />
                <span>Affected by</span>
                <span className="flex gap-1.5">
                  {index.changes.map((c) => (
                    <Link
                      key={c.title}
                      href={changeHref(filter.view, c, filter.change)}
                      tabIndex={-1}
                      data-col={c.index}
                      data-selected={filter.change?.title === c.title || undefined}
                      className="grid w-6 place-items-center rounded-sm font-mono text-2xs transition-colors duration-100 hover:text-fg data-selected:text-fg"
                    >
                      {c.label}
                    </Link>
                  ))}
                </span>
                <span>Analysed</span>
                <span />
              </div>
              <ol className="divide-y divide-rule">
                {attention.map((row) => (
                  <AttentionRow
                    key={row.id}
                    row={row}
                    changes={index.changes}
                    filter={filter}
                    showOwner={showOwner}
                  />
                ))}
              </ol>
            </Section>
          )}

          {pending.length > 0 && (
            <Section id="needs-analysis" title="Needs analysis" count={pending.length}>
              <ol className="divide-y divide-rule">
                {pending.map((row) => (
                  <PendingRow key={row.id} row={row} showOwner={showOwner} />
                ))}
              </ol>
            </Section>
          )}

          {clear.length > 0 && (
            <Section id="clear" title="Clear" count={clear.length}>
              <ol className="divide-y divide-rule">
                {clear.map((row) => (
                  <ClearRow key={row.id} row={row} showOwner={showOwner} />
                ))}
              </ol>
            </Section>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <TrackedChanges changes={index.changes} filter={filter} />
        </aside>
      </div>
    </main>
  );
}
