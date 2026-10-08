import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ExplainAssessment,
  type ExplainResult,
  type FollowUpResult,
  type FollowUpTurn,
} from '../explain-assessment';

afterEach(cleanup);

const EXPLANATION = {
  summary: 'SUMMARY TEXT',
  whyItMatters: 'WHY TEXT',
  nextStep: 'NEXT TEXT',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('ExplainAssessment', () => {
  it('offers a real secondary button, not a link or a clickable div', () => {
    render(
      <ExplainAssessment action={async () => null} label="Explain impact" supportingFacts={[]} />,
    );
    const cta = screen.getByRole('button', { name: 'Explain impact' });
    expect(cta.tagName).toBe('BUTTON');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('renders the module shell immediately while generating, not a bare button label', async () => {
    const user = userEvent.setup();
    const gate = deferred<ExplainResult>();
    render(
      <ExplainAssessment
        action={() => gate.promise}
        label="Explain impact"
        supportingFacts={[{ label: '2 confirmed usages' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Explain impact' }));

    // The frame and its eyebrow are on screen before any prose exists, so the
    // completed result lands inside an already-settled module.
    const shell = await screen.findByRole('region', { name: 'AI explanation' });
    expect(shell.classList.contains('bg-evidence')).toBe(true);
    expect(shell.classList.contains('dark:bg-surface-hover')).toBe(false);
    expect(within(shell).getByText('AI explanation')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('Generating from verified evidence');
    // No fake skeleton lines and no premature content.
    expect(screen.queryByText('SUMMARY TEXT')).toBeNull();

    gate.resolve({ ok: true, explanation: EXPLANATION });
    await waitFor(() => expect(screen.getByText('SUMMARY TEXT')).toBeDefined());
    // Same region, now filled -- the module was never unmounted and rebuilt.
    expect(screen.getByRole('region', { name: 'AI explanation' })).toBeDefined();
  });

  it('renders the three structured sections and the source-of-truth footer', async () => {
    const user = userEvent.setup();
    render(
      <ExplainAssessment
        action={async () => ({ ok: true, explanation: EXPLANATION })}
        label="Explain impact"
        supportingFacts={[]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Explain impact' }));

    // Wait for the generated state before asserting anything about it. The
    // pending shell renders the same `region`, so asserting immediately after
    // the click races the action's resolution: on a fast machine the module is
    // already mounted, on a slower one the shell still is -- and the shell does
    // not carry the module's surface class. That race is what made this test
    // pass locally and fail in CI.
    await screen.findByText(EXPLANATION.summary);

    expect(
      screen
        .getByRole('region', { name: 'AI explanation' })
        .classList.contains('dark:bg-surface-hover'),
    ).toBe(true);
    for (const heading of ['In plain English', 'Why it matters here', 'Next step']) {
      const label = screen.getByText(heading);
      expect(label.classList.contains('font-bold')).toBe(true);
      expect(label.classList.contains('text-fg')).toBe(true);
      expect(label.classList.contains('uppercase')).toBe(false);
    }
    for (const body of Object.values(EXPLANATION)) expect(screen.getByText(body)).toBeDefined();
    expect(screen.getByText(/remain the source of truth/)).toBeDefined();
  });

  it('renders supporting evidence as a list of deterministic facts', async () => {
    const user = userEvent.setup();
    render(
      <ExplainAssessment
        action={async () => ({ ok: true, explanation: EXPLANATION })}
        label="Explain impact"
        supportingFacts={[
          { label: 'Stripe 18.5.0', mono: true },
          { label: '2 confirmed usages', mono: true },
          { label: 'Deterministic fix available' },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Explain impact' }));

    await waitFor(() => expect(screen.getByText('Supporting evidence')).toBeDefined());
    for (const fact of ['Stripe 18.5.0', '2 confirmed usages', 'Deterministic fix available']) {
      expect(screen.getByText(fact)).toBeDefined();
    }
  });

  it('puts the collapse control inside the module header and keeps it keyboard operable', async () => {
    const user = userEvent.setup();
    render(
      <ExplainAssessment
        action={async () => ({ ok: true, explanation: EXPLANATION })}
        label="Explain impact"
        supportingFacts={[]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Explain impact' }));
    await waitFor(() => expect(screen.getByText('SUMMARY TEXT')).toBeDefined());

    const region = screen.getByRole('region', { name: 'AI explanation' });
    const hide = within(region).getByRole('button', { name: 'Hide' });
    // Inside the module, not floating above it.
    expect(region.contains(hide)).toBe(true);
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    expect(hide.getAttribute('aria-controls')).toBe(region.id);

    // Operable from the keyboard, and reversible without regenerating.
    hide.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByText('SUMMARY TEXT')).toBeNull();

    const show = screen.getByRole('button', { name: 'Show explanation' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    await user.click(show);
    await waitFor(() => expect(screen.getByText('SUMMARY TEXT')).toBeDefined());
  });

  it('keeps a failure inside the control and still allows a retry', async () => {
    const user = userEvent.setup();
    render(
      <ExplainAssessment
        action={async () => ({ ok: false, message: 'The explanation service is unavailable.' })}
        label="Explain uncertainty"
        supportingFacts={[]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Explain uncertainty' }));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'The explanation service is unavailable.',
      ),
    );
    // No module is rendered for a failure, and the CTA is still there to retry.
    expect(screen.queryByRole('region', { name: 'AI explanation' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Explain uncertainty' })).toBeDefined();
  });
});

describe('ExplainAssessment follow-ups', () => {
  async function openChat(
    ask: (history: FollowUpTurn[], question: string) => Promise<FollowUpResult>,
    suggestions: string[] = [],
  ) {
    const user = userEvent.setup();
    render(
      <ExplainAssessment
        action={async () => ({ ok: true, explanation: EXPLANATION })}
        ask={ask}
        suggestions={suggestions}
        label="Explain impact"
        supportingFacts={[]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Explain impact' }));
    await screen.findByText(EXPLANATION.summary);
    return user;
  }

  it('offers no composer when no follow-up action is provided', async () => {
    const user = userEvent.setup();
    render(
      <ExplainAssessment
        action={async () => ({ ok: true, explanation: EXPLANATION })}
        label="Explain impact"
        supportingFacts={[]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Explain impact' }));
    await screen.findByText(EXPLANATION.summary);
    expect(screen.queryByLabelText('Ask a follow-up about this change')).toBeNull();
  });

  it('sends a typed question with Enter, shows it pending, then shows the answer', async () => {
    const gate = deferred<FollowUpResult>();
    const calls: { history: FollowUpTurn[]; question: string }[] = [];
    const user = await openChat((history, question) => {
      calls.push({ history, question });
      return gate.promise;
    });

    const input = screen.getByLabelText('Ask a follow-up about this change');
    await user.type(input, '  Which files?  {Enter}');

    expect(calls).toEqual([{ history: [], question: 'Which files?' }]);
    const log = screen.getByRole('log', { name: 'Follow-up questions' });
    expect(within(log).getByText('Which files?')).toBeDefined();
    expect(within(log).getByText('Thinking from verified evidence…')).toBeDefined();
    // The composer clears, and nothing else can be sent while one is in flight.
    expect((input as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);

    gate.resolve({ ok: true, answer: 'src/billing.ts line 5.' });
    // Matched on the paragraph's full text: technical names inside an answer
    // are set in their own mono element, so the string spans two nodes.
    await waitFor(() =>
      expect(
        within(log).getByText(
          (_, element) =>
            element?.tagName === 'P' && element.textContent === 'src/billing.ts line 5.',
        ),
      ).toBeDefined(),
    );
    expect(within(log).queryByText('Thinking from verified evidence…')).toBeNull();
  });

  it('keeps Shift+Enter as a new line rather than sending', async () => {
    const calls: string[] = [];
    const user = await openChat(async (_history, question) => {
      calls.push(question);
      return { ok: true, answer: 'a' };
    });
    const input = screen.getByLabelText('Ask a follow-up about this change');
    await user.type(input, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(calls).toEqual([]);
    expect((input as HTMLTextAreaElement).value).toBe('line one\nline two');
  });

  it('sends the earlier answered turns back with the next question', async () => {
    const calls: { history: FollowUpTurn[]; question: string }[] = [];
    const user = await openChat(async (history, question) => {
      calls.push({ history, question });
      return { ok: true, answer: `answer to ${question}` };
    });
    const input = screen.getByLabelText('Ask a follow-up about this change');
    await user.type(input, 'first{Enter}');
    await screen.findByText('answer to first');
    await user.type(input, 'second{Enter}');
    await screen.findByText('answer to second');

    expect(calls[1]).toEqual({
      history: [{ question: 'first', answer: 'answer to first' }],
      question: 'second',
    });
  });

  it('offers starter questions until the first follow-up, and sends the one tapped', async () => {
    const calls: string[] = [];
    const user = await openChat(
      async (_history, question) => {
        calls.push(question);
        return { ok: true, answer: 'a' };
      },
      ['Which files do I need to change?', 'How do I migrate this?'],
    );
    const suggested = screen.getByRole('list', { name: 'Suggested questions' });
    await user.click(within(suggested).getByRole('button', { name: 'How do I migrate this?' }));

    expect(calls).toEqual(['How do I migrate this?']);
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Suggested questions' })).toBeNull(),
    );
  });

  it('keeps a failed answer in place with its own retry, and the rest of the module intact', async () => {
    let attempt = 0;
    const user = await openChat(async () => {
      attempt += 1;
      return attempt === 1
        ? { ok: false, message: 'The explanation service is unavailable right now.' }
        : { ok: true, answer: 'Now it worked.' };
    });
    await user.type(screen.getByLabelText('Ask a follow-up about this change'), 'Why?{Enter}');

    await screen.findByText(/unavailable right now/);
    // The explanation itself is untouched by a failed follow-up.
    expect(screen.getByText(EXPLANATION.summary)).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Now it worked.');
    expect(screen.queryByText(/unavailable right now/)).toBeNull();
    // The retried question is not duplicated.
    expect(screen.getAllByText('Why?')).toHaveLength(1);
  });

  it('turns a thrown action into a scoped failure rather than an error', async () => {
    const user = await openChat(async () => {
      throw new Error('network down');
    });
    await user.type(screen.getByLabelText('Ask a follow-up about this change'), 'Why?{Enter}');
    await screen.findByText('The answer could not be generated.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('keeps the conversation across Hide and Show', async () => {
    const user = await openChat(async () => ({ ok: true, answer: 'Kept answer.' }));
    await user.type(screen.getByLabelText('Ask a follow-up about this change'), 'Keep?{Enter}');
    await screen.findByText('Kept answer.');

    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Kept answer.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show explanation' }));
    expect(screen.getByText('Kept answer.')).toBeDefined();
  });
});
