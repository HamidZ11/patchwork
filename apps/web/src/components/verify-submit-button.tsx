'use client';

import { useFormStatus } from 'react-dom';

/**
 * The one client component this page needs: a plain form (server action)
 * already works without JS, but useFormStatus requires a client child to
 * show meaningful pending feedback (concise label + disabled state) while
 * the sandbox verification run is being created -- see
 * docs/frontend-design.md's motion restraint (no spinner, no decorative
 * animation, just a state change).
 */
export function VerifySubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
