import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';
import { apiFetch, API_URL } from '@/lib/api';
import { buttonVariantClassName } from '@/components/button-styles';
import { FormSubmitButton } from '@/components/form-submit-button';
import { PatchworkMark } from '@/components/patchwork-mark';
import { PrimaryNav } from '@/components/primary-nav';
import { ProfilePopover } from '@/components/profile-popover';

async function signOut() {
  'use server';
  await apiFetch('/auth/logout', { method: 'POST' });
  redirect('/');
}

/**
 * The persistent authenticated chrome: one compact top shell (DESIGN.md
 * Amendment B1). It replaced the left rail -- a single destination does not
 * earn a column of chrome. Left to right: the mark (home), the primary
 * destinations, then the one global action and the account.
 *
 * Sticky, with the document as the scroll container. It stays a 48px bar at
 * every width; below `sm`, "Add repository" collapses to its icon.
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
      <header className="sticky top-0 z-30 border-b border-rule bg-chrome">
        <div className="mx-auto flex h-12 w-full max-w-300 items-center gap-2 px-4 sm:px-6 lg:px-8">
          <Link
            href="/repositories"
            aria-label="Patchwork"
            className="grid size-8 shrink-0 place-items-center rounded-control text-fg transition-colors duration-100 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none [&_svg]:size-[18px]"
          >
            <PatchworkMark />
          </Link>
          <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-rule-strong" />

          <PrimaryNav />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <a
              href={`${API_URL}/github/install`}
              className={`${buttonVariantClassName.secondary} max-sm:px-2`}
            >
              <Plus aria-hidden="true" className="size-3.5 text-fg-secondary" />
              <span className="max-sm:sr-only">Add repository</span>
            </a>
            <ProfilePopover user={user}>
              <form
                action={signOut}
                className="[&>button]:min-h-10 [&>button]:w-full [&>button]:justify-start [&>button]:px-3"
              >
                <FormSubmitButton label="Sign out" pendingLabel="Signing out…" variant="quiet" />
              </form>
            </ProfilePopover>
          </div>
        </div>
      </header>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
