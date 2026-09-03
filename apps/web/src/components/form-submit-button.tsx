'use client';

import { useFormStatus } from 'react-dom';

const VARIANT_CLASSNAME = {
  // Section 16's Primary fill, at Secondary's compact in-content sizing --
  // not the larger px-5 py-2.5 landing-page Primary. Reserved for the one
  // obvious next action within an active workflow stage (see the
  // fixButtonVariant/verifyButtonVariant/prButtonVariant helpers on the
  // analysis-run detail page) -- never more than one per assessment's
  // pipeline at a time.
  primary:
    'rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white',
  // Section 16's Secondary treatment -- the workhorse for in-content actions.
  secondary:
    'rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900',
  // Reuses the existing quiet text-link language (Section 19's back-link
  // precedent), for a low-emphasis action that isn't the current workflow
  // frontier -- an optional re-run, not a new button treatment.
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
