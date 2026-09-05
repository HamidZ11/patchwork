'use client';

import Image from 'next/image';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function ProfilePopover({
  user,
  children,
}: {
  user: { githubLogin: string; avatarUrl: string | null };
  children: ReactNode;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const profileLinkRef = useRef<HTMLAnchorElement>(null);
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);

  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    // The native top layer avoids clipping. Anchor it without requiring
    // CSS anchor-positioning support, and keep it inside narrow viewports.
    const rect = trigger.getBoundingClientRect();
    const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 16));
    popover.style.top = `${top}px`;
    popover.style.right = `${Math.max(16, document.documentElement.clientWidth - rect.right)}px`;
    popover.style.maxHeight = `${Math.max(0, window.innerHeight - top - 8)}px`;
  }, []);

  useEffect(() => {
    function onResize() {
      if (popoverRef.current?.matches(':popover-open')) positionPopover();
    }
    function onScroll() {
      if (popoverRef.current?.matches(':popover-open')) popoverRef.current.hidePopover();
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
    };
  }, [positionPopover]);

  return (
    <div className="group/profile shrink-0">
      <button
        ref={triggerRef}
        type="button"
        popoverTarget={id}
        popoverTargetAction="toggle"
        aria-haspopup="dialog"
        aria-label={`Profile for ${user.githubLogin}`}
        onClick={(event) => event.currentTarget.focus({ preventScroll: true })}
        className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-md p-1.5 text-sm font-medium text-fg-secondary hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:bg-surface group-has-[:popover-open]/profile:bg-surface group-has-[:popover-open]/profile:text-fg sm:px-2"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-rule bg-evidence text-xs font-semibold text-fg-secondary"
        >
          {user.avatarUrl && failedAvatar !== user.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt=""
              width={32}
              height={32}
              className="size-8 object-cover"
              onError={() => setFailedAvatar(user.avatarUrl)}
            />
          ) : (
            user.githubLogin.slice(0, 2).toUpperCase()
          )}
        </span>
        <span className="hidden max-w-36 truncate sm:block">{user.githubLogin}</span>
        <ChevronDown
          aria-hidden="true"
          className="hidden size-3.5 shrink-0 text-fg-tertiary sm:block"
        />
      </button>

      <div
        ref={popoverRef}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="GitHub account"
        aria-describedby={`${id}-identity`}
        onBeforeToggle={(event) => {
          if (event.newState === 'open') positionPopover();
        }}
        onToggle={(event) => {
          if (event.newState === 'open') profileLinkRef.current?.focus({ preventScroll: true });
        }}
        onBlur={(event) => {
          // WebKit can blur to no target on pointer-down. Hiding here
          // would cancel the link click or reopen the trigger on click.
          if (
            event.relatedTarget !== null &&
            event.relatedTarget !== triggerRef.current &&
            !event.currentTarget.contains(event.relatedTarget) &&
            event.currentTarget.matches(':popover-open')
          ) {
            event.currentTarget.hidePopover();
          }
        }}
        className="fixed inset-auto top-16 right-4 m-0 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-rule-strong bg-surface p-1.5 text-fg"
      >
        <div className="px-3 py-2.5">
          <p id={`${id}-identity`} className="break-all text-sm font-semibold">
            {user.githubLogin}
          </p>
          <p className="mt-0.5 text-xs text-fg-tertiary">GitHub account</p>
        </div>
        <a
          ref={profileLinkRef}
          href={`https://github.com/${encodeURIComponent(user.githubLogin)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center justify-between gap-3 rounded-sm px-3 text-xs font-medium text-fg-secondary hover:bg-evidence hover:text-fg focus-visible:bg-evidence focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg active:bg-evidence"
        >
          <span>
            View GitHub profile<span className="sr-only"> (opens in a new tab)</span>
          </span>
          <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 text-fg-tertiary" />
        </a>
        <div className="mt-1.5 border-t border-rule pt-1.5">{children}</div>
      </div>
    </div>
  );
}
