import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { FormSubmitButton } from '@/components/form-submit-button';
import { PatchworkMark } from '@/components/patchwork-mark';
import { ProfilePopover } from '@/components/profile-popover';

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
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
          <div className="flex min-w-0 self-stretch items-center gap-3 sm:gap-8">
            <Link
              href="/repositories"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md text-base font-semibold text-fg hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-canvas sm:text-lg"
            >
              <PatchworkMark />
              Patchwork
            </Link>

            <nav aria-label="Primary navigation" className="h-full">
              <Link
                href="/repositories"
                aria-current="page"
                className="inline-flex h-full items-center border-b-2 border-fg px-1 text-sm font-semibold text-fg hover:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg sm:px-2"
              >
                Repositories
              </Link>
            </nav>
          </div>

          <ProfilePopover user={user}>
            <form
              action={signOut}
              className="[&>button]:min-h-11 [&>button]:w-full [&>button]:justify-start [&>button]:px-3"
            >
              <FormSubmitButton label="Sign out" pendingLabel="Signing out…" variant="quiet" />
            </form>
          </ProfilePopover>
        </div>
      </header>

      {children}
    </div>
  );
}
