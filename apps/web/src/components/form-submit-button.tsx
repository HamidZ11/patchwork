'use client';

import { useFormStatus } from 'react-dom';
import { buttonVariantClassName } from '@/components/button-styles';

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
  variant?: keyof typeof buttonVariantClassName;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonVariantClassName[variant]}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
