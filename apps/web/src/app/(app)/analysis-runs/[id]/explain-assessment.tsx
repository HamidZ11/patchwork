'use client';

import { useActionState, useId, useState } from 'react';
import { buttonVariantClassName } from '@/components/button-styles';

export interface Explanation {
  summary: string;
  whyItMatters: string;
  nextStep: string;
}

export type ExplainResult =
  { ok: true; explanation: Explanation } | { ok: false; message: string } | null;

/**
 * A deterministic fact Patchwork already established, restated as one short
 * chip beside the generated prose. Every value is computed on the server from
 * the assessment's own persisted state -- never from the model, never
 * invented here.
 */
export interface SupportingFact {
  label: string;
  /** Mono for machine values (a resolved version, a count); prose otherwise. */
  mono?: boolean;
}

/**
 * The one AI-assisted surface in the product.
 *
 * Its whole visual job is to be recognisable at a glance as *generated copy
 * about the evidence*, and never mistakable for the evidence itself. It
 * uses existing neutral surfaces, with a subtly darker expanded panel in
 * dark mode. No gradient, no glow, no glyph -- DESIGN.md Section 15 is
 * explicit that a label which already says the thing does not get an icon,
 * and "AI explanation" says it completely.
 */
export function ExplainAssessment({
  action,
  label,
  supportingFacts,
}: {
  /** A server action already bound to this assessment's id on the server, so
   * the browser never names which assessment to explain and never sees the
   * API or the model provider. It takes no arguments: there is nothing for the
   * client to supply. */
  action: () => Promise<ExplainResult>;
  label: 'Explain impact' | 'Explain uncertainty';
  supportingFacts: SupportingFact[];
}) {
  // `useActionState` drives the form's pending state; the action itself needs
  // neither the previous state nor the form payload, so both are dropped here
  // rather than threaded through a server action that would ignore them.
  const [result, submit, pending] = useActionState<ExplainResult, FormData>(
    async () => action(),
    null,
  );
  // Once generated, toggling is purely local: re-opening never re-submits, so
  // it cannot spend a second generation (the server would serve it from cache
  // anyway, but the request itself is avoidable and so it is avoided).
  const [hidden, setHidden] = useState(false);
  const panelId = useId();

  const explanation = result?.ok ? result.explanation : null;
  const failure = result && !result.ok ? result.message : null;

  if (pending) {
    return <ExplanationShell panelId={panelId} />;
  }

  if (explanation && !hidden) {
    return (
      <ExplanationModule
        panelId={panelId}
        explanation={explanation}
        supportingFacts={supportingFacts}
        onHide={() => setHidden(true)}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      {explanation ? (
        <button
          type="button"
          onClick={() => setHidden(false)}
          aria-expanded={false}
          aria-controls={panelId}
          className={buttonVariantClassName.secondary}
        >
          Show explanation
        </button>
      ) : (
        <form action={submit}>
          <button type="submit" className={buttonVariantClassName.secondary}>
            {label}
          </button>
        </form>
      )}

      {/* A failure is scoped to this control and says so. The assessment above
          it remains exactly as Patchwork proved it -- nothing else on the page
          changes, and nothing was persisted. */}
      {failure && (
        <span role="status" className="text-xs leading-5 text-fg-tertiary">
          {failure} You can try again.
        </span>
      )}
    </div>
  );
}

/**
 * The module's own frame, shared by the loading and generated states so the
 * two are the same object in the same place rather than two different things
 * that happen to appear in sequence. That is what keeps the layout shift to
 * the body alone: the border, the header row and the eyebrow are
 * already on screen before the first word of the explanation exists.
 */
function ExplanationFrame({
  panelId,
  control,
  children,
  surfaceClassName = 'bg-evidence',
}: {
  panelId: string;
  control: React.ReactNode;
  children: React.ReactNode;
  surfaceClassName?: string;
}) {
  return (
    <section
      id={panelId}
      aria-label="AI explanation"
      className={`min-w-0 overflow-hidden rounded-md border border-rule ${surfaceClassName}`}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule px-4 py-2.5">
        <p className="text-2xs font-semibold tracking-wide text-fg-tertiary uppercase">
          AI explanation
        </p>
        {control}
      </div>
      {children}
    </section>
  );
}

/**
 * Rendered the instant the action is submitted, in the module's final
 * position.
 *
 * Deliberately not a skeleton of fake paragraph lines: Patchwork does not know
 * how long the explanation will be, and drawing placeholder text implies it
 * does. The header is the real header and the status line is real copy, so
 * the only thing that changes on completion is that the body arrives beneath
 * an already-settled frame.
 *
 * The pulsing dot reuses the product's single existing animated treatment --
 * the `RUNNING` status dot (DESIGN.md Sections 11 and 28) -- rather than
 * introducing a second vocabulary for the same idea: something is in progress.
 * `motion-reduce:animate-none` because an indeterminate indicator that runs
 * for several seconds is exactly the case reduced-motion exists for; the dot
 * stays visible, it just stops pulsing.
 */
function ExplanationShell({ panelId }: { panelId: string }) {
  return (
    <ExplanationFrame panelId={panelId} control={null}>
      <p
        role="status"
        aria-live="polite"
        className="flex min-w-0 items-center gap-2 px-4 py-3 text-sm leading-6 text-fg-tertiary"
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-mark-indeterminate motion-reduce:animate-none"
        />
        Generating from verified evidence…
      </p>
    </ExplanationFrame>
  );
}

function ExplanationModule({
  panelId,
  explanation,
  supportingFacts,
  onHide,
}: {
  panelId: string;
  explanation: Explanation;
  supportingFacts: SupportingFact[];
  onHide: () => void;
}) {
  return (
    <ExplanationFrame
      panelId={panelId}
      surfaceClassName="bg-evidence dark:bg-surface-hover"
      control={
        // Belongs to the module, not floating above it: the control that
        // closes a panel lives in that panel's own header.
        <button
          type="button"
          onClick={onHide}
          aria-expanded
          aria-controls={panelId}
          className="rounded-sm text-xs font-medium text-fg-tertiary hover:text-fg focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
        >
          Hide
        </button>
      }
    >
      <div className="flex min-w-0 flex-col gap-4 px-4 py-4">
        <ExplanationSection heading="In plain English" body={explanation.summary} />
        <ExplanationSection heading="Why it matters here" body={explanation.whyItMatters} />
        <ExplanationSection heading="Next step" body={explanation.nextStep} />

        {supportingFacts.length > 0 && (
          <div className="flex min-w-0 flex-col gap-2 border-t border-rule pt-4">
            <p className="text-2xs font-semibold tracking-wide text-fg-tertiary uppercase">
              Supporting evidence
            </p>
            {/* Not cards. Each chip is one fact Patchwork proved, restated at
                the smallest size that stays legible, so the reader can check
                the prose above against the record without leaving the module. */}
            <ul className="flex min-w-0 flex-wrap gap-1.5">
              {supportingFacts.map((fact) => (
                <li
                  key={fact.label}
                  className={`rounded-sm border border-rule px-2 py-1 text-2xs leading-4 text-fg-secondary ${
                    fact.mono ? 'font-mono' : ''
                  }`}
                >
                  {fact.label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="border-t border-rule px-4 py-2.5 text-xs leading-5 text-fg-tertiary">
        Patchwork&rsquo;s deterministic verdict, checks and patch state remain the source of truth.
      </p>
    </ExplanationFrame>
  );
}

function ExplanationSection({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-2xs font-bold tracking-normal text-fg">{heading}</p>
      <p className="text-sm leading-6 break-words text-fg-secondary">{body}</p>
    </div>
  );
}
