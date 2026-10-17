import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentBriefButton } from '../agent-brief-button';
import { AGENT_BRIEF } from '../agent-brief';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stubClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: spy } });
  return spy;
}

const NAME = 'Copy agent.md, a setup brief for coding agents';

describe('AgentBriefButton', () => {
  it('is a real button with a descriptive accessible name', () => {
    render(<AgentBriefButton />);
    const button = screen.getByRole('button', { name: NAME });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
  });

  it('copies exactly the agent brief', async () => {
    const writeText = stubClipboard(async () => {});
    render(<AgentBriefButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: NAME }));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(AGENT_BRIEF);
  });

  it('shows and announces "Copied", then returns to idle', async () => {
    vi.useFakeTimers();
    stubClipboard(async () => {});
    render(<AgentBriefButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: NAME }));
    });

    expect(screen.getByRole('status').textContent).toBe('Agent brief copied to clipboard');
    expect(screen.getByText('Copied').className).not.toContain('invisible');
    expect(screen.getByText('agent.md').className).toContain('invisible');

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByText('agent.md').className).not.toContain('invisible');
  });

  it('falls back to select-and-copy, with exactly the agent brief, when the Clipboard API is denied', async () => {
    stubClipboard(async () => {
      throw new Error('denied');
    });
    let copied: string | undefined;
    document.execCommand = vi.fn(() => {
      copied = document.querySelector('textarea')?.value;
      return true;
    });
    render(<AgentBriefButton />);
    const button = screen.getByRole('button', { name: NAME });
    button.focus();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(copied).toBe(AGENT_BRIEF);
    expect(screen.getByRole('status').textContent).toBe('Agent brief copied to clipboard');
    // The temporary textarea is gone and focus is back on the button.
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('says so when both copy paths fail', async () => {
    stubClipboard(async () => {
      throw new Error('denied');
    });
    document.execCommand = vi.fn(() => false);
    render(<AgentBriefButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: NAME }));
    });

    expect(screen.getByRole('status').textContent).toBe('Could not copy the agent brief');
    expect(screen.getByText('Copied').className).toContain('invisible');
  });
});

describe('AGENT_BRIEF', () => {
  it('covers each section a coding agent needs, in order', () => {
    const headings = [...AGENT_BRIEF.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([
      'What Patchwork does',
      'Requirements',
      'Setup',
      'What happens after setup',
      'Reviewing, merging and rolling back',
      'Limits',
      'Links',
    ]);
  });
});
