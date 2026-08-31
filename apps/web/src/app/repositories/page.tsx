import { redirect } from 'next/navigation';
import { ErrorBanner } from '@/components/error-banner';
import { apiFetch, API_URL } from '@/lib/api';

interface LatestAnalysisStripeSummary {
  resolvedVersion: string | null;
  declaredRange: string;
  workspacePath: string;
}

interface ImpactFinding {
  sourceFile: string;
  line: number;
  matchedSymbol: string;
}

interface LatestImpactAssessment {
  providerChangeTitle: string;
  status: string;
  reason: string;
  findings: ImpactFinding[];
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

async function analyseRepository(repositoryId: string) {
  'use server';
  await apiFetch(`/repositories/${repositoryId}/analyses`, { method: 'POST' });
  redirect('/repositories');
}

async function checkStripeImpact(analysisRunId: string) {
  'use server';
  await apiFetch(`/analysis-runs/${analysisRunId}/impact-assessments`, { method: 'POST' });
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
        {repositories.map((repo) => (
          <li key={repo.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                {repo.fullName}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {repo.isPrivate ? 'Private' : 'Public'} · default branch {repo.defaultBranch}
              </span>
              {repo.latestAnalysis && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Commit {repo.latestAnalysis.commitSha.slice(0, 7)} · {repo.latestAnalysis.status}
                </span>
              )}
              {repo.latestAnalysis?.stripe && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Stripe: {repo.latestAnalysis.stripe.resolvedVersion ?? 'unresolved'} (declared{' '}
                  {repo.latestAnalysis.stripe.declaredRange})
                </span>
              )}
              {repo.latestAnalysis?.latestImpactAssessments.map((assessment) => (
                <div
                  key={assessment.providerChangeTitle}
                  className="mt-1 flex flex-col gap-0.5 rounded border border-zinc-200 px-2 py-1.5 dark:border-zinc-800"
                >
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Stripe change: {assessment.providerChangeTitle}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    Status: {assessment.status}
                  </span>
                  {assessment.findings.map((finding) => (
                    <span
                      key={`${finding.sourceFile}:${finding.line}`}
                      className="text-xs text-zinc-500 dark:text-zinc-400"
                    >
                      Evidence: {finding.sourceFile}:{finding.line} — {finding.matchedSymbol}
                    </span>
                  ))}
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    Reason: {assessment.reason}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <form action={analyseRepository.bind(null, repo.id)}>
                <button
                  type="submit"
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Analyse repository
                </button>
              </form>
              {repo.latestAnalysis && (
                <form action={checkStripeImpact.bind(null, repo.latestAnalysis.analysisRunId)}>
                  <button
                    type="submit"
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Check Stripe impact
                  </button>
                </form>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Connected
              </span>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
