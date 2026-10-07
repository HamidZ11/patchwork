'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FolderGit2 } from 'lucide-react';

/**
 * Every authenticated route today belongs to the repository workflow -- the
 * index, one repository, and an analysis report reached from it -- so the one
 * item stays marked as the current section on all of them. `aria-current`
 * is only set on the index itself, the one place where "this page" is true;
 * deeper pages carry their own breadcrumb.
 */
function isRepositoriesSection(pathname: string): boolean {
  return (
    pathname === '/repositories' ||
    pathname.startsWith('/repositories/') ||
    pathname.startsWith('/analysis-runs/')
  );
}

/**
 * The shell's destinations, as compact items in the top bar. One today, on
 * purpose: Activity and Settings are not listed until they exist (DESIGN.md
 * Amendment B1), so the shell never offers a dead or disabled entry.
 */
export function PrimaryNav() {
  const pathname = usePathname();
  const active = isRepositoriesSection(pathname);

  return (
    <nav aria-label="Primary" className="min-w-0">
      <ul className="flex items-center gap-1">
        <li>
          <Link
            href="/repositories"
            aria-current={pathname === '/repositories' ? 'page' : undefined}
            data-active={active || undefined}
            className="flex h-8 items-center gap-2 rounded-control px-2.5 text-ui font-medium text-fg-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none data-active:bg-surface data-active:text-fg data-active:shadow-btn"
          >
            <FolderGit2 aria-hidden="true" className="size-4 shrink-0" />
            Repositories
          </Link>
        </li>
      </ul>
    </nav>
  );
}
