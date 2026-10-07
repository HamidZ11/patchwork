'use client';

import { useFormStatus } from 'react-dom';
import { Play, RotateCw } from 'lucide-react';

/**
 * The index's analyse control, inside a server-action form (DESIGN.md
 * Amendment B5). Quiet by design -- text until hovered -- so the action
 * column never becomes a stack of boxes. Three intents, one action:
 *   analyse    a never-analysed repository -- labelled
 *   retry      failed or not assessed -- labelled
 *   reanalyse  a clear repository -- an icon, named for assistive tech
 * While the action runs the control is disabled and says "Analysing…" --
 * a state change, not a spinner (DESIGN.md Section 24). The repository name
 * is in the accessible name, so ten "Retry" buttons are distinguishable.
 */
export function AnalyseButton({
  intent,
  repositoryName,
}: {
  intent: 'analyse' | 'retry' | 'reanalyse';
  repositoryName: string;
}) {
  const { pending } = useFormStatus();
  const focus =
    'transition-[background-color,color,scale] duration-150 ease-out-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-wait disabled:active:scale-100';

  if (intent === 'reanalyse' && !pending) {
    return (
      <button
        type="submit"
        title="Re-analyse"
        className={`grid size-7 place-items-center rounded-control text-fg-tertiary hover:bg-surface hover:text-fg ${focus}`}
      >
        <RotateCw aria-hidden="true" className="size-3.5" />
        <span className="sr-only">Re-analyse {repositoryName}</span>
      </button>
    );
  }

  const Icon = intent === 'analyse' ? Play : RotateCw;
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-ui font-medium text-fg-secondary hover:bg-surface hover:text-fg disabled:text-fg-tertiary ${focus}`}
    >
      {pending ? (
        'Analysing…'
      ) : (
        <>
          <Icon aria-hidden="true" className="size-3.5 text-fg-tertiary" />
          {intent === 'analyse' ? 'Analyse' : 'Retry'}
          <span className="sr-only"> {repositoryName}</span>
        </>
      )}
    </button>
  );
}
