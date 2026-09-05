import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssessmentSelector, type AssessmentTab } from '../assessment-selector';
import { ExplainAssessment, type ExplainResult } from '../explain-assessment';

afterEach(cleanup);

/**
 * A stand-in for one server-rendered assessment report. The real page hands
 * the selector fully-formed elements; what matters for this test is that each
 * one carries its own `ExplainAssessment` bound to its own action, exactly as
 * the server binds one per assessment id.
 */
function tab(
  id: string,
  explanation: string,
  action?: () => Promise<ExplainResult>,
): AssessmentTab {
  return {
    id,
    title: `Change ${id}`,
    statusLabel: 'Affected',
    statusDotClassName: '',
    statusTextClassName: '',
    evidenceLabel: null,
    report: (
      <article>
        <h2>Report {id}</h2>
        <ExplainAssessment
          action={
            action ??
            (async () => ({
              ok: true,
              explanation: { summary: explanation, whyItMatters: 'w', nextStep: 'n' },
            }))
          }
          label="Explain impact"
          supportingFacts={[{ label: `fact-${id}` }]}
        />
      </article>
    ),
  };
}

describe('AssessmentSelector panel identity', () => {
  /**
   * Regression: an explanation generated for one assessment rendered under a
   * different one.
   *
   * Every report has the same element shape, so before the panel was keyed by
   * the selected assessment id, React reconciled the incoming report onto the
   * outgoing one's fibers at the same position and `ExplainAssessment` kept
   * its `useActionState` result across the switch. The panel then showed
   * assessment A's generated prose while assessment B was selected -- for an
   * assessment that had never requested an explanation at all.
   */
  it('never shows one assessment’s explanation under another', async () => {
    const user = userEvent.setup();
    render(
      <AssessmentSelector
        items={[tab('a', 'EXPLANATION FOR A'), tab('b', 'EXPLANATION FOR B')]}
        defaultSelectedId="a"
      />,
    );

    // 1-2. Generate and show A's explanation.
    await user.click(screen.getByRole('button', { name: 'Explain impact' }));
    await waitFor(() => expect(screen.getByText('EXPLANATION FOR A')).toBeDefined());

    // 3-4. Switching to B must not carry A's explanation across.
    await user.click(screen.getByRole('tab', { name: /Change b/ }));
    expect(screen.queryByText('EXPLANATION FOR A')).toBeNull();
    expect(screen.queryByText('EXPLANATION FOR B')).toBeNull();
    // B offers to generate its own, rather than showing a toggle for prose it
    // never produced.
    expect(screen.getByRole('button', { name: 'Explain impact' })).toBeDefined();

    // 5-6. B generates its own.
    await user.click(screen.getByRole('button', { name: 'Explain impact' }));
    await waitFor(() => expect(screen.getByText('EXPLANATION FOR B')).toBeDefined());
    expect(screen.queryByText('EXPLANATION FOR A')).toBeNull();

    // 7-8. Returning to A must not show B's, and must not resurrect A's stale
    // client state either -- the panel is rebuilt from that assessment alone.
    await user.click(screen.getByRole('tab', { name: /Change a/ }));
    expect(screen.queryByText('EXPLANATION FOR B')).toBeNull();
    expect(screen.queryByText('EXPLANATION FOR A')).toBeNull();
    expect(screen.getByRole('button', { name: 'Explain impact' })).toBeDefined();
  });

  it('does not carry an AFFECTED explanation onto an UNCERTAIN assessment', async () => {
    const user = userEvent.setup();
    const uncertain = tab('u', 'UNCERTAIN PROSE');
    uncertain.statusLabel = 'Uncertain';
    uncertain.report = (
      <article>
        <h2>Report u</h2>
        <ExplainAssessment
          action={async () => ({
            ok: true,
            explanation: { summary: 'UNCERTAIN PROSE', whyItMatters: 'w', nextStep: 'n' },
          })}
          label="Explain uncertainty"
          supportingFacts={[{ label: 'fact-u' }]}
        />
      </article>
    );

    render(
      <AssessmentSelector items={[tab('a', 'AFFECTED PROSE'), uncertain]} defaultSelectedId="a" />,
    );

    await user.click(screen.getByRole('button', { name: 'Explain impact' }));
    await waitFor(() => expect(screen.getByText('AFFECTED PROSE')).toBeDefined());

    await user.click(screen.getByRole('tab', { name: /Change u/ }));
    expect(screen.queryByText('AFFECTED PROSE')).toBeNull();
    // The CTA is the UNCERTAIN one, so the panel really is the other
    // assessment's, not a re-labelled reuse of the previous one.
    expect(screen.getByRole('button', { name: 'Explain uncertainty' })).toBeDefined();
  });

  it('requests an explanation from the selected assessment’s own action only', async () => {
    const user = userEvent.setup();
    const actionA = vi.fn(async () => ({
      ok: true as const,
      explanation: { summary: 'EXPLANATION FOR A', whyItMatters: 'w', nextStep: 'n' },
    }));
    const actionB = vi.fn(async () => ({
      ok: true as const,
      explanation: { summary: 'EXPLANATION FOR B', whyItMatters: 'w', nextStep: 'n' },
    }));

    render(
      <AssessmentSelector
        items={[tab('a', 'EXPLANATION FOR A', actionA), tab('b', 'EXPLANATION FOR B', actionB)]}
        defaultSelectedId="a"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Explain impact' }));
    await waitFor(() => expect(actionA).toHaveBeenCalledTimes(1));
    expect(actionB).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: /Change b/ }));
    await user.click(screen.getByRole('button', { name: 'Explain impact' }));
    await waitFor(() => expect(actionB).toHaveBeenCalledTimes(1));
    // A's action is never invoked again by B's panel.
    expect(actionA).toHaveBeenCalledTimes(1);
  });
});
