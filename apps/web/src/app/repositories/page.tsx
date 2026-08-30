import { redirect } from 'next/navigation';
import { ErrorBanner } from '@/components/error-banner';
import { apiFetch, API_URL } from '@/lib/api';

interface Repository {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
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
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Connected
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
