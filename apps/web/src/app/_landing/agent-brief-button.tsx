'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { AGENT_BRIEF } from './agent-brief';

const RESET_MS = 1600;

type CopyState = 'idle' | 'copied' | 'failed';

const LABEL: Record<CopyState, string> = {
  idle: 'agent.md',
  copied: 'Copied',
  failed: 'Failed',
};

const ANNOUNCEMENT: Record<CopyState, string> = {
  idle: '',
  copied: 'Agent brief copied to clipboard',
  failed: 'Could not copy the agent brief',
};

/**
 * The async Clipboard API first; where it is missing or denied (a plain-http
 * host, some embedded webviews), the older select-and-copy path, which still
 * works inside the click's user activation. Throws only if both fail.
 */
async function writeToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    if (!copyBySelection(text)) throw error;
  }
}

function copyBySelection(text: string): boolean {
  const previousFocus = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus();
  }
}

/**
 * Copies the agent brief (`agent-brief.ts`) to the clipboard. A quiet
 * header control, not a call to action: mono text and a small icon, no fill
 * until hovered. The label swaps to "Copied" for a moment; the labels share
 * one grid cell, so the button keeps its width and the header never shifts.
 * Below `md` it collapses to its icon (as AppShell's "Add repository" does),
 * which turns to a check on success; the accessible name never changes.
 * A failed copy says so rather than pretending.
 */
export function AgentBriefButton() {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let next: CopyState;
    try {
      await writeToClipboard(AGENT_BRIEF);
      next = 'copied';
    } catch {
      next = 'failed';
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), RESET_MS);
  }

  const Icon = state === 'copied' ? Check : Copy;

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy agent.md, a setup brief for coding agents"
        title="Copy a setup brief for your coding agent"
        className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-control px-2 font-mono text-xs text-fg-tertiary transition-[background-color,color,scale] duration-150 ease-out-strong hover:bg-surface hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none active:scale-[0.97] motion-reduce:active:scale-100"
      >
        <span aria-hidden="true" className="grid max-md:hidden">
          {(Object.keys(LABEL) as CopyState[]).map((key) => (
            <span
              key={key}
              className={`col-start-1 row-start-1 ${key === state ? '' : 'invisible'}`}
            >
              {LABEL[key]}
            </span>
          ))}
        </span>
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      </button>
      <span role="status" className="sr-only">
        {ANNOUNCEMENT[state]}
      </span>
    </>
  );
}
