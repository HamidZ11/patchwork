import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExplainAssessment, type ExplainResult } from '../explain-assessment';

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

    expect(
      screen
        .getByRole('region', { name: 'AI explanation' })
        .classList.contains('dark:bg-surface-hover'),
    ).toBe(true);
    for (const heading of ['In plain English', 'Why it matters here', 'Next step']) {
      await waitFor(() => expect(screen.getByText(heading)).toBeDefined());
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
