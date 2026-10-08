import type { Metadata } from 'next';
import Link from 'next/link';
import { NotFoundMessage } from '@/components/not-found-message';
import { PatchworkMark } from '@/components/patchwork-mark';

export const metadata: Metadata = { title: 'Page not found · Patchwork' };

/**
 * Any address that matches no route. Rendered in the root layout only, so
 * it carries its own minimal bar: the mark, home. Home sends a signed-in
 * reader on to their repositories.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-rule bg-chrome">
        <div className="mx-auto flex h-12 w-full max-w-300 items-center px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-control text-sm font-semibold tracking-tight text-fg focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none [&_svg]:size-[18px]"
          >
            <PatchworkMark />
            Patchwork
          </Link>
        </div>
      </header>
      <NotFoundMessage href="/" label="Back to Patchwork" />
    </div>
  );
}
