import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, Lock } from 'lucide-react';
import { buttonVariantClassName } from '@/components/button-styles';
import { ErrorBanner } from '@/components/error-banner';
import { FormSubmitButton } from '@/components/form-submit-button';
import { apiFetch } from '@/lib/api';
import { analyseRepository } from '../actions';
import { Breakable } from '../breakable';
import { TechText } from '../tech-text';
import { PatchGlyph } from '../patch-glyph';
import { buildRepositoryIndex, indexHref, type TrackedChange } from '../repository-index';
import {
  analysedAt,
  ASSESSMENT_LABEL,
  computeImpactState,
  formatAbsoluteTime,
  formatRelativeTime,
  isRootWorkspace,
  sortAssessments,
  sortFindings,
  totalUsageLabel,
  usageLabel,
  verdictCopy,
  type AssessmentStatus,
  type Finding,
  type ImpactState,
  type ImpactStateKind,
  type LatestAnalysis,
  type LatestImpactAssessment,
  type Repository,
} from '../repository-state';
import { PAGE_GRID, PAGE_MAIN, Section } from '../section';

/**
 * A repository's own page (DESIGN.md Amendment B7): the index's
 * composition, narrowed to one repository. The main column holds the
 * verdict and, per tracked change, what it rests on -- where an affected
 * change is used, why an uncertain one could not be decided. The sidebar
 * holds the snapshot the verdict is true about. Code context, AI
 * explanations and fixes stay in the impact report, one click away.
 *
 * There is no `GET /repositories/:id` yet, so this reads the same
 * ownership-scoped `GET /repositories` the index uses and picks the record
 * out of it -- identical authorization, no new API surface. A repository the
 * list does not return is a 404, never someone else's data. The rest of the
 * list is used for one thing: the estate-wide change numbers and counts, so
 * `02` here is `02` on the index.
 */
async function loadRepositories(
  id: string,
): Promise<{ repo: Repository; repositories: Repository[] }> {
  const response = await apiFetch('/repositories');
  if (!response.ok) throw new Error(`Failed to load repositories (${response.status})`);
  const { repositories } = (await response.json()) as { repositories: Repository[] };
  const repo = repositories.find((candidate) => candidate.id === id);
  if (!repo) notFound();
  return { repo, repositories };
}

const VERDICT_TONE: Record<ImpactStateKind, string> = {
  affected: 'text-attention',
  uncertain: 'text-indeterminate',
  clear: 'text-success',
  failed: 'text-failure',
  not_assessed: 'text-fg-secondary',
  not_analysed: 'text-fg-secondary',
};

const STATUS_TONE: Record<AssessmentStatus, string> = {
  AFFECTED: 'text-attention',
  UNCERTAIN: 'text-indeterminate',
  NOT_AFFECTED: 'text-fg-tertiary',
};

/** Only a completed run with assessments has changes to list; anything
 * else has no verdict to break down. */
function hasVerdict(state: ImpactState): boolean {
  return state.kind === 'affected' || state.kind === 'uncertain' || state.kind === 'clear';
}

function reportHref(analysis: LatestAnalysis): string {
  return `/analysis-runs/${encodeURIComponent(analysis.analysisRunId)}`;
}

/** The verdict's next step, beside what it acts on: the report once there
 * is a verdict, otherwise the analysis that would produce one. */
function VerdictAction({ repo, state }: { repo: Repository; state: ImpactState }) {
  if (hasVerdict(state) && repo.latestAnalysis) {
    return (
      <Link
        href={reportHref(repo.latestAnalysis)}
        className={
          state.kind === 'clear' ? buttonVariantClassName.secondary : buttonVariantClassName.primary
        }
      >
        Open impact report
      </Link>
    );
  }
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

/** The strongest object on the page, built like the impact report's header
 * (DESIGN.md Amendment B10): the verdict as a small label with its glyph,
 * the headline it rests on as the page's largest type, one relevance line,
 * and the action. */
function Verdict({ repo, state }: { repo: Repository; state: ImpactState }) {
  const copy = verdictCopy(state);
  const detail = [
    hasVerdict(state) && repo.latestAnalysis
      ? totalUsageLabel(repo.latestAnalysis.latestImpactAssessments)
      : null,
    copy.secondary,
  ].filter(Boolean);

  return (
    <section
      aria-labelledby="verdict"
      className="flex flex-col gap-6 rounded-window bg-panel px-6 py-7 shadow-card sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="min-w-0">
        <p
          className={`inline-flex items-center gap-2 text-xs font-medium ${VERDICT_TONE[state.kind]}`}
        >
          <PatchGlyph kind={state.kind} className="size-3.5" />
          {copy.title}
        </p>
        <h2
          id="verdict"
          className="mt-2 max-w-[32ch] text-title font-semibold text-fg sm:text-display sm:tracking-[-0.015em]"
        >
          {copy.headline}
        </h2>
        {detail.length > 0 && (
          <p className="mt-3 text-ui text-fg-secondary tabular-nums">{detail.join(' · ')}</p>
        )}
      </div>
      <div className="shrink-0">
        <VerdictAction repo={repo} state={state} />
      </div>
    </section>
  );
}

/** At most this many locations per change; the report has the rest. */
const LOCATIONS_SHOWN = 5;

/** Where an affected change is used: file, line and the matched symbol.
 * Static facts, so no hover affordance. */
function Locations({ findings, report }: { findings: Finding[]; report: string }) {
  const sorted = sortFindings(findings);
  const shown = sorted.slice(0, LOCATIONS_SHOWN);
  const more = sorted.length - shown.length;
  return (
    <div className="mt-3">
      <ol className="divide-y divide-rule overflow-hidden rounded-control bg-raised shadow-hairline">
        {shown.map((finding) => (
          <li
            key={`${finding.sourceFile}:${finding.line}:${finding.matchedSymbol}`}
            className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 px-3 py-2 font-mono text-xs"
          >
            <span className="min-w-0 break-all text-fg-secondary">
              {finding.sourceFile}
              <span className="text-fg-tertiary">:{finding.line}</span>
            </span>
            <code className="min-w-0 break-all text-fg">{finding.matchedSymbol}</code>
          </li>
        ))}
      </ol>
      {more > 0 && (
        <Link
          href={report}
          className="mt-2 inline-block rounded-chip text-xs text-fg-tertiary transition-colors duration-100 hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          {more} more in the impact report
        </Link>
      )}
    </div>
  );
}

/** Other repositories this change affects or leaves uncertain, as a link
 * to the index filtered by it. Absent when this repository is the only
 * one. */
function ElsewhereLink({ change }: { change: TrackedChange }) {
  // This repository is one of the hits: the row only renders for its own
  // AFFECTED or UNCERTAIN changes.
  const others = change.affectedRepos + change.uncertainRepos - 1;
  if (others < 1) return null;
  return (
    <Link
      href={indexHref('all', change)}
      className="group inline-flex shrink-0 items-center gap-1 rounded-chip text-xs text-fg-tertiary transition-colors duration-100 hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
    >
      {others} other {others === 1 ? 'repository' : 'repositories'}
      <span className="sr-only"> with change {change.label}</span>
      <ArrowRight
        aria-hidden="true"
        className="size-3 transition-[translate] duration-150 ease-out-strong group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
      />
    </Link>
  );
}

/**
 * One tracked change. Text is spent where it decides something: an
 * affected change lists where it is used (or, with no located usage, the
 * analyser's reason); an uncertain one says why it could not be decided; a
 * change that does not affect the repository is one quiet line.
 */
function ChangeRow({
  assessment,
  change,
  report,
}: {
  assessment: LatestImpactAssessment;
  change: TrackedChange | undefined;
  report: string;
}) {
  const { status } = assessment;
  const label = (
    <span className="font-mono text-2xs leading-5 text-fg-tertiary">{change?.label}</span>
  );

  if (status === 'NOT_AFFECTED') {
    return (
      <li className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-3 px-5 py-3">
        {label}
        <p className="text-ui [overflow-wrap:anywhere] text-fg-secondary">
          <Breakable text={assessment.providerChangeTitle} />
        </p>
        <span className={`text-ui ${STATUS_TONE[status]}`}>{ASSESSMENT_LABEL[status]}</span>
      </li>
    );
  }

  const usage = usageLabel(assessment);
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 px-5 py-4">
      {label}
      <div className="min-w-0">
        <p className="text-sm [overflow-wrap:anywhere] text-fg">
          <Breakable text={assessment.providerChangeTitle} />
        </p>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-ui">
            <span className={`font-medium ${STATUS_TONE[status]}`}>{ASSESSMENT_LABEL[status]}</span>
            {usage && <span className="text-fg-tertiary tabular-nums"> · {usage}</span>}
          </p>
          {change && <ElsewhereLink change={change} />}
        </div>
        {status === 'AFFECTED' && assessment.findings.length > 0 ? (
          <Locations findings={assessment.findings} report={report} />
        ) : (
          <p className="mt-2 max-w-[70ch] text-sm leading-6 [overflow-wrap:anywhere] text-fg-secondary">
            <TechText text={assessment.reason} />
          </p>
        )}
      </div>
    </li>
  );
}

/** Every tracked change in the latest run, decisions first, then in the
 * index's change order. */
function Changes({ analysis, changes }: { analysis: LatestAnalysis; changes: TrackedChange[] }) {
  const byTitle = new Map(changes.map((change) => [change.title, change]));
  const order = (a: LatestImpactAssessment) =>
    byTitle.get(a.providerChangeTitle)?.index ?? Number.MAX_SAFE_INTEGER;
  const assessments = sortAssessments(
    analysis.latestImpactAssessments,
    (a, b) => order(a) - order(b) || a.providerChangeTitle.localeCompare(b.providerChangeTitle),
  );
  const report = reportHref(analysis);

  return (
    <Section id="changes" title="Changes" count={assessments.length}>
      <ol className="divide-y divide-rule">
        {assessments.map((assessment) => (
          <ChangeRow
            key={assessment.providerChangeTitle}
            assessment={assessment}
            change={byTitle.get(assessment.providerChangeTitle)}
            report={report}
          />
        ))}
      </ol>
    </Section>
  );
}

/** The snapshot the verdict is true about: an assessment is a claim about
 * one commit at one SDK version, not about the repository forever. */
function Snapshot({ analysis }: { analysis: LatestAnalysis | null }) {
  if (!analysis) {
    return (
      <section aria-labelledby="snapshot">
        <h2 id="snapshot" className="text-ui font-medium text-fg">
          Snapshot
        </h2>
        <p className="mt-3 text-ui text-fg-tertiary">No analysis has run yet.</p>
      </section>
    );
  }

  const when = analysedAt(analysis);
  const { stripe } = analysis;
  const facts: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    {
      label: 'Stripe SDK',
      value: stripe ? (
        <>
          {stripe.resolvedVersion ?? stripe.declaredRange}
          {stripe.resolvedVersion === null && (
            <span className="font-sans text-fg-tertiary"> declared</span>
          )}
        </>
      ) : analysis.status === 'completed' ? (
        'Not detected'
      ) : (
        'Unknown'
      ),
      mono: stripe !== null,
    },
    ...(stripe
      ? [
          {
            label: 'Workspace',
            value: isRootWorkspace(stripe.workspacePath) ? 'Repository root' : stripe.workspacePath,
            mono: !isRootWorkspace(stripe.workspacePath),
          },
        ]
      : []),
    {
      label: 'Commit',
      value: <span title={analysis.commitSha}>{analysis.commitSha.slice(0, 7)}</span>,
      mono: true,
    },
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
    <section aria-labelledby="snapshot">
      <h2 id="snapshot" className="text-ui font-medium text-fg">
        Snapshot
      </h2>
      <dl className="mt-3 divide-y divide-rule border-y border-rule">
        {facts.map((fact) => (
          <div key={fact.label} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 py-2.5">
            <dt className="text-ui text-fg-tertiary">{fact.label}</dt>
            <dd
              className={`min-w-0 truncate text-fg ${fact.mono ? 'font-mono text-xs leading-5' : 'text-ui'}`}
            >
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
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
  const { repo, repositories } = await loadRepositories(id);
  const state = computeImpactState(repo);
  const analysis = repo.latestAnalysis;
  const { changes } = buildRepositoryIndex(repositories);

  return (
    <main className={PAGE_MAIN}>
      <Link
        href="/repositories"
        className="group -ml-1 inline-flex items-center gap-1.5 rounded-control px-1 text-ui text-fg-tertiary transition-colors duration-100 hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      >
        <ArrowLeft
          aria-hidden="true"
          className="size-3.5 transition-[translate] duration-150 ease-out-strong group-hover:-translate-x-0.5 motion-reduce:group-hover:translate-x-0"
        />
        Repositories
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-title font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] text-fg">
            <span className="font-normal text-fg-tertiary">{repo.owner} / </span>
            {repo.name}
          </h1>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-fg-tertiary">
            {repo.isPrivate && <Lock aria-hidden="true" className="size-3.5" />}
            {repo.isPrivate ? 'Private' : 'Public'}
            <span aria-hidden="true">·</span>
            <span className="font-mono text-xs">{repo.defaultBranch}</span>
          </p>
        </div>
        {hasVerdict(state) && (
          <form action={analyseRepository.bind(null, repo.id, 'repository')}>
            <FormSubmitButton label="Re-analyse" pendingLabel="Analysing…" variant="secondary" />
          </form>
        )}
      </header>

      {error && (
        <div className="mt-6">
          <ErrorBanner code={error} />
        </div>
      )}

      <div className={PAGE_GRID}>
        <div className="flex min-w-0 flex-col gap-10">
          <Verdict repo={repo} state={state} />
          {analysis && hasVerdict(state) && <Changes analysis={analysis} changes={changes} />}
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Snapshot analysis={analysis} />
        </aside>
      </div>
    </main>
  );
}
