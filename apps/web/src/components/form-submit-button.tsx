'use client';

import { useFormStatus } from 'react-dom';

/**
 * The one submit-button pattern this page needs, reused for every
 * server-action mutation (sandbox verification, GitHub pull-request
 * creation): a plain form (server action) already works without JS, but
 * useFormStatus requires a client child to show meaningful pending
 * feedback (concise label + disabled state) while the mutation runs --
 * see DESIGN.md Section 16 (Buttons) and Section 28 (Motion): no
 * spinner, no decorative animation, just a state change. One button
 * component, reused, rather than one per action per DESIGN.md's "one
 * documented way to do a thing" principle (Section 2).
 */
export function FormSubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
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
