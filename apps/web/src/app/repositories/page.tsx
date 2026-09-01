import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ErrorBanner } from '@/components/error-banner';
import { apiFetch, API_URL } from '@/lib/api';

interface LatestAnalysisStripeSummary {
  resolvedVersion: string | null;
  declaredRange: string;
  workspacePath: string;
}

interface LatestImpactAssessment {
  status: string;
}

interface LatestAnalysis {
  analysisRunId: string;
  commitSha: string;
  status: string;
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

const STATUS_ORDER = ['AFFECTED', 'UNCERTAIN', 'NOT_AFFECTED'] as const;

const STATUS_STYLE: Record<
  (typeof STATUS_ORDER)[number],
  { dot: string; text: string; label: string }
> = {
  AFFECTED: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', label: 'affected' },
  UNCERTAIN: {
    dot: 'bg-slate-500',
    text: 'text-slate-600 dark:text-slate-400',
    label: 'uncertain',
  },
  NOT_AFFECTED: {
    dot: 'bg-zinc-400 dark:bg-zinc-600',
    text: 'text-zinc-500 dark:text-zinc-400',
    label: 'not affected',
  },
};

function countByStatus(assessments: LatestImpactAssessment[]): Record<string, number> {
  const counts: Record<string, number> = { AFFECTED: 0, UNCERTAIN: 0, NOT_AFFECTED: 0 };
  for (const assessment of assessments) {
    if (assessment.status in counts) counts[assessment.status] += 1;
  }
  return counts;
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

export default async function RepositoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const me = await apiFetch('/auth/me');
  if (!me.ok) redirect('/');

  const reposResponse = await apiFetch('/repositories');
  const { repositories } = reposResponse.ok
    ? ((await reposResponse.json()) as { repositories: Repository[] })
    : { repositories: [] };

  if (repositories.length === 0) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Connect your first repository
          </h1>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Patchwork needs access only to repositories you explicitly select.
          </p>
        </div>

        <ErrorBanner code={error} />

        <a
          href={`${API_URL}/github/install`}
          className="inline-flex items-center justify-center rounded-md bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          Select repositories on GitHub
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Repositories
      </h1>

      <ErrorBanner code={error} />

      <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {repositories.map((repo) => {
          const { latestAnalysis } = repo;
          const counts = latestAnalysis
            ? countByStatus(latestAnalysis.latestImpactAssessments)
            : null;

          return (
            <li
              key={repo.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                  {repo.fullName}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {repo.isPrivate ? 'Private' : 'Public'} · default branch {repo.defaultBranch}
                </span>
                {latestAnalysis ? (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {latestAnalysis.stripe &&
                      `Stripe ${latestAnalysis.stripe.resolvedVersion ?? 'unresolved'} · `}
                    commit {latestAnalysis.commitSha.slice(0, 7)}
                    {latestAnalysis.status !== 'completed' && ` · ${latestAnalysis.status}`}
                  </span>
                ) : (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">Not analysed yet</span>
                )}
                {counts &&
                  (counts.AFFECTED > 0 || counts.UNCERTAIN > 0 || counts.NOT_AFFECTED > 0) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs">
                      {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
                        <span
                          key={status}
                          className={`inline-flex items-center gap-1.5 ${STATUS_STYLE[status].text}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${STATUS_STYLE[status].dot}`}
                            aria-hidden="true"
                          />
                          {counts[status]} {STATUS_STYLE[status].label}
                        </span>
                      ))}
                    </div>
                  )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {latestAnalysis && (
                  <Link
                    href={`/analysis-runs/${latestAnalysis.analysisRunId}`}
                    className="rounded-md bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                  >
                    View impact report
                  </Link>
                )}
                <form action={analyseRepository.bind(null, repo.id)}>
                  <button
                    type="submit"
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Analyse repository
                  </button>
                </form>
                <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  Connected
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
