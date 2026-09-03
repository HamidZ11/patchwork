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

/**
 * The one persistent piece of chrome in the product, present on every
 * authenticated route (DESIGN.md Section 5). Deliberately just a thin top
 * bar, not a sidebar: Patchwork has exactly one top-level destination
 * today (Repositories), so the wordmark itself is the only navigational
 * link -- a center nav with a single item would be decoration, not
 * navigation, and Section 5 is explicit that center-aligned nav links
 * wait for a second real top-level section to exist. Add one back in when
 * that happens, not before.
 */
export function AppShell({
  user,
  children,
}: {
  user: { githubLogin: string; avatarUrl: string | null };
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="w-full border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex h-14 w-full items-center justify-between px-6">
          <Link
            href="/repositories"
            className="text-sm font-semibold tracking-tight text-zinc-950 transition-colors hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300"
          >
            Patchwork
          </Link>

          <div className="flex items-center gap-3">
            {user.avatarUrl && (
              <Image
                src={user.avatarUrl}
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 rounded-full"
              />
            )}
            <span className="hidden text-xs font-medium text-zinc-700 sm:inline dark:text-zinc-300">
              {user.githubLogin}
            </span>
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
