import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariantClassName } from '@/components/button-styles';
import { ErrorBanner } from '@/components/error-banner';
import { FormSubmitButton } from '@/components/form-submit-button';
import { apiFetch } from '@/lib/api';
import { analyseRepository } from '../actions';
import {
  analysedAt,
  ASSESSMENT_LABEL,
  ASSESSMENT_STYLE,
  computeImpactState,
  formatAbsoluteTime,
  formatRelativeTime,
  IMPACT_STATE_STYLE,
  sortAssessments,
  stripeVersionLabel,
  usageLabel,
  verdictCopy,
  type ImpactState,
  type LatestAnalysis,
  type Repository,
} from '../repository-state';
import { StatusMark } from '../status-mark';

/**
 * A repository's own page (DESIGN.md Amendment A5). Overview only: no tab
 * bar until a second tab is genuinely usable. The change-by-change report
 * still lives at `/analysis-runs/[id]` and is one click away from the
 * verdict.
 *
 * There is no `GET /repositories/:id` yet, so this reads the same
 * ownership-scoped `GET /repositories` the index uses and picks the record
 * out of it -- identical authorization, no new API surface. A repository the
 * list does not return is a 404, never someone else's data.
 */
async function loadRepository(id: string): Promise<Repository> {
  const response = await apiFetch('/repositories');
  if (!response.ok) throw new Error(`Failed to load repositories (${response.status})`);
  const { repositories } = (await response.json()) as { repositories: Repository[] };
  const repository = repositories.find((repo) => repo.id === id);
  if (!repository) notFound();
  return repository;
}

/** The verdict's primary next step sits inside the verdict, beside what it
 * acts on; a report link only exists for a completed run with assessments. */
function VerdictAction({ repo, state }: { repo: Repository; state: ImpactState }) {
  const analysis = repo.latestAnalysis;
  switch (state.kind) {
    case 'affected':
    case 'uncertain':
    case 'clear':
      return (
        <Link
          href={`/analysis-runs/${encodeURIComponent(analysis!.analysisRunId)}`}
          className={
            state.kind === 'clear'
              ? buttonVariantClassName.secondary
              : buttonVariantClassName.primary
          }
        >
          Open impact report
        </Link>
      );
    case 'not_analysed':
    case 'failed':
    case 'not_assessed':
      return (
        <form action={analyseRepository.bind(null, repo.id, 'repository')}>
          <FormSubmitButton
            label={state.kind === 'not_analysed' ? 'Analyse repository' : 'Retry analysis'}
            pendingLabel="Analysing…"
            variant="primary"
          />
        </form>
      );
  }
}

/**
 * The strongest object on the page. It gets more room than anything else
 * on purpose (hybrid density): the verdict is the one answer the reader came
 * for, so the title carries the status colour at display size, and the
 * counts beneath it say how much. Colour is always paired with the word.
 */
function Verdict({ repo, state }: { repo: Repository; state: ImpactState }) {
  const copy = verdictCopy(state);
  const style = IMPACT_STATE_STYLE[state.kind];

  return (
    <section
      aria-labelledby="verdict-title"
      className="flex flex-col gap-6 px-5 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:py-7"
    >
      <div className="min-w-0">
        <h2
          id="verdict-title"
          className={`flex items-center gap-3 text-3xl font-semibold tracking-tight ${style.text}`}
        >
          <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${style.dot}`} />
          {copy.title}
        </h2>
        <p className="mt-3 text-base font-medium text-fg">{copy.headline}</p>
        {copy.secondary && (
          <p className="mt-1 flex items-center gap-2 text-sm text-fg-tertiary">
            {state.kind === 'affected' && (
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${IMPACT_STATE_STYLE.uncertain.dot}`}
              />
            )}
            {copy.secondary}
          </p>
        )}
      </div>
      <div className="shrink-0">
        <VerdictAction repo={repo} state={state} />
      </div>
    </section>
  );
}

/**
 * The snapshot the verdict is true about. A verdict is a claim about one
 * commit at one SDK version, so these sit directly under it, inside the same
 * object, rather than floating as page metadata.
 */
function SnapshotFacts({ analysis }: { analysis: LatestAnalysis }) {
  const when = analysedAt(analysis);
  const facts: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    {
      label: 'Stripe SDK',
      value: analysis.stripe
        ? stripeVersionLabel(analysis.stripe)
        : analysis.status === 'completed'
          ? 'Not detected'
          : 'Unknown',
      mono: analysis.stripe !== null,
    },
    { label: 'Snapshot', value: analysis.commitSha.slice(0, 7), mono: true },
    {
      label: 'Analysis',
      value:
        analysis.status === 'completed'
          ? 'Completed'
          : analysis.status === 'failed'
            ? 'Failed'
            : analysis.status,
    },
    {
      label: 'Analysed',
      value: (
        <time dateTime={when.toISOString()} title={formatAbsoluteTime(when)}>
          {formatRelativeTime(when)}
        </time>
      ),
    },
  ];

  return (
    // `gap-px` over a rule-coloured ground draws the hairlines between cells,
    // so the same markup reads correctly as a 2x2 block and as one strip.
    <dl className="grid grid-cols-2 gap-px border-t border-rule bg-rule sm:grid-cols-4">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0 bg-chrome px-5 py-3 sm:px-6">
          <dt className="text-xs text-fg-tertiary">{fact.label}</dt>
          <dd className={`mt-1 truncate text-sm text-fg ${fact.mono ? 'font-mono' : ''}`}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The latest analysis, summarised: every tracked change and its verdict.
 * Rows are static evidence, not links -- the list API carries no assessment
 * id, so a row cannot open its own change, and five rows all opening the
 * same report would be five duplicate targets. The verdict's one report
 * button is the way in.
 */
function ChangeSummary({ analysis }: { analysis: LatestAnalysis }) {
  const assessments = sortAssessments(analysis.latestImpactAssessments);
  if (assessments.length === 0) return null;

  return (
    <section aria-labelledby="changes-title" className="flex flex-col gap-3">
      <h2 id="changes-title" className="flex items-baseline gap-2 text-sm font-semibold text-fg">
        Changes in this analysis
        <span className="text-xs font-normal text-fg-tertiary tabular-nums">
          {assessments.length}
        </span>
      </h2>
      <ul className="divide-y divide-rule rounded-md border border-rule">
        {assessments.map((assessment) => {
          const usages = usageLabel(assessment);
          const quiet = assessment.status === 'NOT_AFFECTED';
          return (
            <li
              key={`${assessment.status}-${assessment.providerChangeTitle}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_9rem] sm:items-center sm:px-5"
            >
              <p
                className={`col-span-2 text-sm leading-5 sm:col-span-1 ${quiet ? 'text-fg-tertiary' : 'text-fg'}`}
              >
                {assessment.providerChangeTitle}
              </p>
              <StatusMark
                label={ASSESSMENT_LABEL[assessment.status]}
                style={ASSESSMENT_STYLE[assessment.status]}
                className="text-xs font-medium"
              />
              <span className="text-right text-xs text-fg-tertiary tabular-nums">{usages}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default async function RepositoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const repo = await loadRepository(id);
  const state = computeImpactState(repo);
  const analysis = repo.latestAnalysis;
  const canReanalyse =
    state.kind === 'affected' || state.kind === 'uncertain' || state.kind === 'clear';

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 pt-6 pb-16 sm:px-6 md:pt-8 lg:px-8">
      <div className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb">
          <ol className="flex min-w-0 items-center gap-1.5 text-xs text-fg-tertiary">
            <li>
              <Link
                href="/repositories"
                className="rounded-sm hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                Repositories
              </Link>
            </li>
            <li aria-hidden="true" className="text-fg-faint">
              /
            </li>
            <li aria-current="page" className="min-w-0 truncate font-mono text-fg-secondary">
              {repo.name}
            </li>
          </ol>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight break-words text-fg">
              <span className="font-normal text-fg-tertiary">{repo.owner}/</span>
              {repo.name}
            </h1>
            <p className="mt-0.5 font-mono text-2xs text-fg-tertiary">
              {repo.isPrivate ? 'private' : 'public'} · {repo.defaultBranch}
            </p>
          </div>
          {canReanalyse && (
            <form action={analyseRepository.bind(null, repo.id, 'repository')}>
              <FormSubmitButton label="Re-analyse" pendingLabel="Analysing…" variant="secondary" />
            </form>
          )}
        </div>
      </div>

      <ErrorBanner code={error} />

      <div className="overflow-hidden rounded-md border border-rule bg-surface-hover">
        <Verdict repo={repo} state={state} />
        {analysis && <SnapshotFacts analysis={analysis} />}
      </div>

      {analysis && <ChangeSummary analysis={analysis} />}
    </main>
  );
}
