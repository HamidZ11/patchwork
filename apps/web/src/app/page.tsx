import { redirect } from 'next/navigation';
import { ErrorBanner } from '@/components/error-banner';
import { apiFetch, API_URL } from '@/lib/api';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const me = await apiFetch('/auth/me');
  if (me.ok) {
    redirect(error ? `/repositories?error=${error}` : '/repositories');
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
      <div className="flex max-w-xl flex-col items-center gap-6 text-center">
        <span className="text-sm font-medium uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Patchwork
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl dark:text-zinc-50">
          API changes → affected code → verified fix
        </h1>
      </div>

      <ErrorBanner code={error} />

      <a
        href={`${API_URL}/auth/github/login`}
        className="inline-flex items-center justify-center rounded-md bg-zinc-950 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        Continue with GitHub
      </a>
    </main>
  );
}
