import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { buttonVariantClassName } from '@/components/button-styles';
import { RequestedPath } from '@/components/requested-path';

/** The Patchwork mark with its two blocks pulled apart at the joint: the
 * same geometry the product uses for a failed analysis (DESIGN.md Amendment
 * B4), drawn in a neutral tone because a missing page is not a verdict. */
function SeparatedMark() {
  return (
    <svg viewBox="-1 -1 30 30" aria-hidden="true" className="size-12 text-fg-tertiary">
      <path d="M2 2h20v6h-8v6H8v8H2V2Z" fill="currentColor" />
      <path d="M22 10h-6v6h-6v6h12V10Z" transform="translate(3.5 3.5)" fill="currentColor" />
    </svg>
  );
}

/**
 * The 404 message (DESIGN.md Amendment B12). One message for every
 * not-found case, because the API deliberately answers an unknown id and
 * another account's id the same way: saying "doesn't exist" for both would
 * be a guess, so the copy names both.
 */
export function NotFoundMessage({
  href,
  label,
}: {
  /** Where the one action goes: the index inside the app, home outside it. */
  href: string;
  label: string;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-24">
      <div className="flex max-w-md flex-col items-start">
        <SeparatedMark />
        <p className="mt-8 font-mono text-xs text-fg-tertiary">404</p>
        <h1 className="mt-2 text-display font-semibold tracking-[-0.015em] text-fg">
          Page not found
        </h1>
        <p className="mt-3 text-body text-fg-secondary">
          This page doesn’t exist, or it belongs to an account you aren’t signed in to.
        </p>
        <RequestedPath />
        <Link href={href} className={`group mt-8 pl-2.5 ${buttonVariantClassName.primary}`}>
          <ArrowLeft
            aria-hidden="true"
            className="size-3.5 transition-[translate] duration-150 ease-out-strong group-hover:-translate-x-0.5 motion-reduce:group-hover:translate-x-0"
          />
          {label}
        </Link>
      </div>
    </main>
  );
}
