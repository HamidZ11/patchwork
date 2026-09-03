import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { FormSubmitButton } from '@/components/form-submit-button';

async function signOut() {
  'use server';
  await apiFetch('/auth/logout', { method: 'POST' });
  redirect('/');
}

/** The persistent authenticated chrome. It stays a thin top bar: the
 * product has one real top-level destination, so a sidebar would invent
 * hierarchy that does not exist. The single nav item communicates current
 * location, while the product mark remains the route home. */
export function AppShell({
  user,
  children,
}: {
  user: { githubLogin: string; avatarUrl: string | null };
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="w-full border-b border-rule bg-canvas">
        <div className="mx-auto flex h-18 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 self-stretch items-center gap-3 sm:gap-7">
            <Link
              href="/repositories"
              className="inline-flex shrink-0 items-center rounded-md text-lg font-semibold tracking-tight text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Patchwork
            </Link>

            <nav
              aria-label="Primary navigation"
              className="h-full border-l border-rule pl-3 sm:pl-7"
            >
              <Link
                href="/repositories"
                aria-current="page"
                className="inline-flex h-full items-center border-b-2 border-fg px-1 text-sm font-semibold text-fg transition-colors hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg"
              >
                Repositories
              </Link>
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 border-r border-rule pr-2 sm:pr-3">
              {user.avatarUrl && (
                <Image
                  src={user.avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full border border-rule"
                />
              )}
              <span className="hidden text-sm font-semibold text-fg-secondary md:inline">
                {user.githubLogin}
              </span>
            </div>
            <form action={signOut}>
              <FormSubmitButton label="Sign out" pendingLabel="Signing out…" variant="quiet" />
            </form>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
