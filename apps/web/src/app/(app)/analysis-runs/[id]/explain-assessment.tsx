'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { buttonVariantClassName } from '@/components/button-styles';
import { TechText } from '../../repositories/tech-text';

export interface Explanation {
  summary: string;
  whyItMatters: string;
  nextStep: string;
}

export type ExplainResult =
  { ok: true; explanation: Explanation } | { ok: false; message: string } | null;

/** One earlier exchange, sent back with the next question: the API keeps no
 * conversation, so the page is where the thread lives. */
export interface FollowUpTurn {
  question: string;
  answer: string;
}

export type FollowUpResult = { ok: true; answer: string } | { ok: false; message: string };

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

/** Mirrors the API's bounds (`followUpRequestSchema`): a question's length,
 * and how many earlier turns go back with it. */
const MAX_QUESTION_LENGTH = 500;
const HISTORY_SENT = 6;
/** Follow-ups per page. Rate limiting is not built yet, so the page caps its
 * own spend; a reload starts a new conversation. */
const MAX_FOLLOW_UPS = 10;

type Turn = {
  id: number;
  question: string;
} & (
  | { status: 'pending' }
  | { status: 'answered'; answer: string }
  | { status: 'failed'; message: string }
);

/**
 * The one AI-assisted surface in the product: a plain-English explanation of
 * the verdict, then follow-up questions about it.
 *
 * Its whole visual job is to be recognisable at a glance as *generated copy
 * about the evidence*, and never mistakable for the evidence itself. It uses
 * existing neutral surfaces with a hairline edge, and a subtly darker
 * expanded panel. No gradient, no glow, no glyph -- DESIGN.md Section 15 is
 * explicit that a label which already says the thing does not get an icon,
 * and "AI explanation" says it completely.
 *
 * The conversation is held here, above the Hide toggle, so hiding and
 * re-showing keeps it; it is never stored server-side, and it belongs to this
 * assessment alone -- the selector remounts the report on every switch.
 */
export function ExplainAssessment({
  action,
  label,
  supportingFacts,
  ask,
  suggestions = [],
}: {
  /** A server action already bound to this assessment's id on the server, so
   * the browser never names which assessment to explain and never sees the
   * API or the model provider. It takes no arguments: there is nothing for the
   * client to supply. */
  action: () => Promise<ExplainResult>;
  label: 'Explain impact' | 'Explain uncertainty';
  supportingFacts: SupportingFact[];
  /** Follow-ups, bound to the same assessment on the server. The page's
   * own earlier turns and the new question are all the client supplies.
   * Without it the explanation renders with no composer. */
  ask?: (history: FollowUpTurn[], question: string) => Promise<FollowUpResult>;
  /** Starter questions, offered before the first follow-up. */
  suggestions?: string[];
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
  const [turns, setTurns] = useState<Turn[]>([]);
  const nextId = useRef(0);
  const panelId = useId();

  const explanation = result?.ok ? result.explanation : null;
  const failure = result && !result.ok ? result.message : null;

  async function runTurn(id: number, question: string, history: FollowUpTurn[]) {
    if (!ask) return;
    let outcome: FollowUpResult;
    try {
      outcome = await ask(history, question);
    } catch {
      outcome = { ok: false, message: 'The answer could not be generated.' };
    }
    setTurns((current) =>
      current.map((turn) =>
        turn.id !== id
          ? turn
          : outcome.ok
            ? { id, question, status: 'answered', answer: outcome.answer }
            : { id, question, status: 'failed', message: outcome.message },
      ),
    );
  }

  /** The answered turns before `index`, newest last, capped as the API caps. */
  function historyBefore(index: number): FollowUpTurn[] {
    return turns
      .slice(0, index)
      .flatMap((turn) =>
        turn.status === 'answered' ? [{ question: turn.question, answer: turn.answer }] : [],
      )
      .slice(-HISTORY_SENT);
  }

  function sendQuestion(text: string) {
    const question = text.trim();
    if (!question || turns.some((turn) => turn.status === 'pending')) return;
    if (turns.length >= MAX_FOLLOW_UPS) return;
    const id = nextId.current++;
    const history = historyBefore(turns.length);
    setTurns((current) => [...current, { id, question, status: 'pending' }]);
    void runTurn(id, question, history);
  }

  function retry(id: number) {
    const index = turns.findIndex((turn) => turn.id === id);
    const turn = turns[index];
    if (!turn || turn.status !== 'failed') return;
    const history = historyBefore(index);
    setTurns((current) =>
      current.map((t) => (t.id === id ? { id, question: t.question, status: 'pending' } : t)),
    );
    void runTurn(id, turn.question, history);
  }

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
        conversation={
          ask ? (
            <Conversation
              turns={turns}
              suggestions={suggestions}
              onSend={sendQuestion}
              onRetry={retry}
            />
          ) : null
        }
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
 * the body alone: the edge, the header row and the label are already on
 * screen before the first word of the explanation exists.
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
      className={`min-w-0 overflow-hidden rounded-card shadow-hairline ${surfaceClassName}`}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule px-5 py-2.5">
        <p className="text-xs font-medium text-fg-secondary">AI explanation</p>
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
        className="flex min-w-0 items-center gap-2 px-5 py-3 text-sm leading-6 text-fg-tertiary"
      >
        <PendingDot />
        Generating from verified evidence…
      </p>
    </ExplanationFrame>
  );
}

function PendingDot() {
  return (
    <span
      aria-hidden="true"
      className="size-1.5 shrink-0 animate-pulse rounded-full bg-mark-indeterminate motion-reduce:animate-none"
    />
  );
}

function ExplanationModule({
  panelId,
  explanation,
  supportingFacts,
  onHide,
  conversation,
}: {
  panelId: string;
  explanation: Explanation;
  supportingFacts: SupportingFact[];
  onHide: () => void;
  conversation: React.ReactNode;
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
          className="rounded-chip text-xs font-medium text-fg-tertiary transition-colors duration-100 hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          Hide
        </button>
      }
    >
      {/* Spacing does the grouping (DESIGN.md Amendment B10): 6px from a
          heading to its paragraph, 24px between sections -- no box around
          any of them. */}
      <div className="flex min-w-0 flex-col gap-6 px-5 py-5">
        <ExplanationSection heading="In plain English" body={explanation.summary} />
        <ExplanationSection heading="Why it matters here" body={explanation.whyItMatters} />
        <ExplanationSection heading="Next step" body={explanation.nextStep} />

        {supportingFacts.length > 0 && (
          <div className="flex min-w-0 flex-col gap-1.5 border-t border-rule pt-5">
            <p className="text-xs font-medium text-fg-tertiary">Supporting evidence</p>
            {/* Not cards: one line of facts Patchwork proved, so the reader can
                check the prose above against the record without leaving the
                module. Mono only for a machine value such as a version. */}
            <ul className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-fg-secondary">
              {supportingFacts.map((fact, index) => (
                <li key={fact.label} className="inline-flex items-baseline gap-x-2">
                  {index > 0 && (
                    <span aria-hidden="true" className="text-fg-tertiary">
                      ·
                    </span>
                  )}
                  <span className={fact.mono ? 'font-mono text-2xs text-fg' : undefined}>
                    {fact.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {conversation}
      </div>

      <p className="border-t border-rule px-5 py-2.5 text-xs leading-5 text-fg-tertiary">
        Patchwork&rsquo;s deterministic verdict, checks and patch state remain the source of truth.
      </p>
    </ExplanationFrame>
  );
}

function ExplanationSection({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-xs font-bold text-fg">{heading}</p>
      <p className="max-w-[70ch] text-sm leading-6 break-words text-fg">
        <TechText text={body} />
      </p>
    </div>
  );
}

/**
 * Follow-ups beneath the explanation: the reader's questions as quiet
 * right-aligned bubbles, answers as prose in the explanation's own voice,
 * then starter questions and the composer.
 *
 * The thread is a `log`, so each answer is announced as it arrives. A
 * failed answer stays in place with its own retry -- the rest of the thread
 * is untouched -- and only one question is ever in flight.
 */
function Conversation({
  turns,
  suggestions,
  onSend,
  onRetry,
}: {
  turns: Turn[];
  suggestions: string[];
  onSend: (question: string) => void;
  onRetry: (id: number) => void;
}) {
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const hintId = useId();
  const lastTurn = useRef<HTMLLIElement>(null);
  const busy = turns.some((turn) => turn.status === 'pending');
  const remaining = MAX_FOLLOW_UPS - turns.length;
  const atLimit = remaining <= 0;
  const canSend = draft.trim().length > 0 && !busy && !atLimit;

  // Keep the newest exchange in view without yanking the page: `nearest`
  // scrolls only when it is out of view, and never animates under reduced
  // motion.
  useEffect(() => {
    if (turns.length === 0) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    lastTurn.current?.scrollIntoView?.({
      block: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [turns.length]);

  function send(text: string) {
    if (busy || atLimit || !text.trim()) return;
    onSend(text);
    setDraft('');
  }

  return (
    // A band of its own, a step darker than the explanation above it, so the
    // place to type reads as distinct from the prose already written -- and
    // the lighter composer inside it reads as a field, not as more panel.
    <div className="-mx-5 -mb-5 flex min-w-0 flex-col gap-4 border-t border-rule bg-raised px-5 pt-5 pb-5">
      <p className="text-xs font-medium text-fg-secondary">Ask a follow-up</p>
      {turns.length > 0 && (
        <ol role="log" aria-label="Follow-up questions" className="flex min-w-0 flex-col gap-4">
          {turns.map((turn, index) => (
            <li
              key={turn.id}
              ref={index === turns.length - 1 ? lastTurn : undefined}
              className="flex min-w-0 flex-col gap-2"
            >
              <p className="max-w-[85%] self-end rounded-card bg-evidence px-3 py-2 text-ui break-words whitespace-pre-line text-fg shadow-btn">
                <span className="sr-only">You asked: </span>
                {turn.question}
              </p>
              {turn.status === 'pending' && (
                <p className="flex items-center gap-2 text-sm leading-6 text-fg-tertiary">
                  <PendingDot />
                  Thinking from verified evidence…
                </p>
              )}
              {turn.status === 'answered' && (
                <p className="max-w-[70ch] text-sm leading-6 break-words whitespace-pre-line text-fg">
                  <TechText text={turn.answer} />
                </p>
              )}
              {turn.status === 'failed' && (
                <p className="flex flex-wrap items-baseline gap-x-2 text-xs leading-5 text-fg-tertiary">
                  {turn.message}
                  <button
                    type="button"
                    onClick={() => onRetry(turn.id)}
                    disabled={busy}
                    className="rounded-chip font-medium text-fg-secondary transition-colors duration-100 hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none disabled:opacity-50"
                  >
                    Try again
                  </button>
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {turns.length === 0 && suggestions.length > 0 && (
        <ul aria-label="Suggested questions" className="flex min-w-0 flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => send(suggestion)}
                className="rounded-chip bg-surface px-2.5 py-1 text-xs text-fg-secondary shadow-btn transition-[background-color,color,scale] duration-150 ease-out-strong hover:bg-evidence hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none active:scale-[0.97] motion-reduce:active:scale-100"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
        // The one inset surface in the product (`bg-field`, near-black): a
        // well to type into, set below the band rather than raised off it,
        // with a lit hairline so its edge holds on the dark band.
        className="flex min-w-0 flex-col gap-2 rounded-card bg-field p-2 shadow-[inset_0_1px_3px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.1)] transition-shadow duration-150 focus-within:shadow-[inset_0_1px_3px_rgb(0_0_0/0.5),0_0_0_2px_var(--focus)]"
      >
        <label htmlFor={inputId} className="sr-only">
          Ask a follow-up about this change
        </label>
        <textarea
          id={inputId}
          rows={1}
          value={draft}
          maxLength={MAX_QUESTION_LENGTH}
          disabled={atLimit}
          aria-describedby={hintId}
          placeholder="Ask a follow-up about this change…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a new line; an IME composition's
            // Enter confirms the composition, never the message.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(draft);
            }
          }}
          className="block max-h-40 min-h-11 w-full resize-none bg-transparent px-1.5 py-1 text-ui text-fg [field-sizing:content] outline-none placeholder:text-fg-tertiary disabled:cursor-not-allowed"
        />
        <div className="flex items-center justify-between gap-3 pl-1.5">
          <p id={hintId} className="min-w-0 text-xs text-fg-tertiary">
            {atLimit
              ? 'Follow-up limit reached. Reload the page to start a new conversation.'
              : draft.length > MAX_QUESTION_LENGTH - 50
                ? `${MAX_QUESTION_LENGTH - draft.length} characters left`
                : 'Answers use only Patchwork’s evidence for this change.'}
          </p>
          <button
            type="submit"
            aria-label="Send"
            disabled={!canSend}
            className="grid size-7 shrink-0 place-items-center rounded-control bg-fg text-canvas transition-[background-color,color,scale] duration-150 ease-out-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none enabled:active:scale-[0.96] disabled:bg-surface disabled:text-fg-tertiary motion-reduce:enabled:active:scale-100"
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
