'use client';

import { useFormStatus } from 'react-dom';

const VARIANT_CLASSNAME = {
  // Section 16's Secondary treatment -- the workhorse for in-content actions.
  secondary:
    'rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900',
  // Reuses the existing quiet text-link language (Section 19's back-link
  // precedent), for a single low-emphasis shell-level action -- not a new
  // button treatment, an extension of an already-established one.
  quiet:
    'text-xs text-zinc-500 transition-colors hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-400 dark:hover:text-zinc-200',
} as const;

/**
 * The one submit-button pattern this page needs, reused for every
 * server-action mutation (sandbox verification, GitHub pull-request
 * creation, sign-out): a plain form (server action) already works
 * without JS, but useFormStatus requires a client child to show
 * meaningful pending feedback (concise label + disabled state) while the
 * mutation runs -- see DESIGN.md Section 16 (Buttons) and Section 28
 * (Motion): no spinner, no decorative animation, just a state change.
 * One button component, reused, rather than one per action per
 * DESIGN.md's "one documented way to do a thing" principle (Section 2).
 */
export function FormSubmitButton({
  label,
  pendingLabel,
  variant = 'secondary',
}: {
  label: string;
  pendingLabel: string;
  variant?: keyof typeof VARIANT_CLASSNAME;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={VARIANT_CLASSNAME[variant]}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
