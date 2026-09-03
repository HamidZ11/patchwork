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
        <span className="text-fg-tertiary text-sm font-medium tracking-widest uppercase">
          Patchwork
        </span>
        <h1 className="text-fg text-3xl font-semibold tracking-tight sm:text-4xl">
          API changes → affected code → verified fix
        </h1>
      </div>

      <ErrorBanner code={error} />

      <a
        href={`${API_URL}/auth/github/login`}
        className="bg-accent-strong text-accent-strong-fg hover:bg-accent-strong-hover inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium transition-colors"
      >
        Continue with GitHub
      </a>
    </main>
  );
}
