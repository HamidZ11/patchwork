'use client';

import { usePathname } from 'next/navigation';

/** The address that was not found, as a literal value in mono -- so a
 * mistyped or stale link is visible rather than guessed at. */
export function RequestedPath() {
  const pathname = usePathname();
  if (!pathname || pathname === '/') return null;
  return (
    <p className="mt-4 max-w-full rounded-chip bg-surface px-2 py-1 font-mono text-xs break-all text-fg-secondary shadow-hairline">
      {pathname}
    </p>
  );
}
