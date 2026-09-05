import Link from 'next/link';
import { PatchworkMark } from '@/components/patchwork-mark';
import { API_URL } from '@/lib/api';
import { Container } from './primitives';

export const SIGN_IN = `${API_URL}/auth/github/login`;

/**
 * Shared chrome for the public routes.
 *
 * The nav previously lived inside the landing page and used bare
 * `#how-it-works` / `#trust` fragments, which resolve to nothing on any route
 * but `/`. Root-relative fragments (`/#…`) work from anywhere, so a second
 * public route cannot silently inherit a dead link -- the reason this is a
 * shared component rather than page-local markup.
 */
const NAV_LINKS = [
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#trust', label: 'Guarantees' },
];

const QUIET_LINK =
  'rounded-sm text-sm text-fg-tertiary hover:text-fg focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none';

export function PublicNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-rule/70 bg-canvas/85 backdrop-blur-sm">
      <Container className="flex h-16 items-center justify-between gap-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 rounded-md text-base font-semibold tracking-tight text-fg focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none"
        >
          <PatchworkMark />
          Patchwork
        </Link>

        <div className="flex items-center gap-2 sm:gap-5">
          {/* Two links, both to real destinations. No Pricing, Blog, Customers or Docs:
              none exist, and a nav item that resolves to nothing is the first
              thing that makes a portfolio page read as a template. */}
          <nav aria-label="Public navigation" className="hidden items-center gap-5 sm:flex">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className={QUIET_LINK}>
                {link.label}
              </Link>
            ))}
          </nav>
          <a href={SIGN_IN} className={`${QUIET_LINK} px-1`}>
            Sign in
          </a>
          <a
            href={SIGN_IN}
            className="inline-flex min-h-9 items-center justify-center rounded-md bg-accent px-3.5 text-xs font-semibold whitespace-nowrap text-accent-fg transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none"
          >
            Connect GitHub
          </a>
        </div>
      </Container>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-rule py-10">
      <Container className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg">
          <PatchworkMark />
          Patchwork
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className={QUIET_LINK}>
              {link.label}
            </Link>
          ))}
          <a href={SIGN_IN} className={QUIET_LINK}>
            Sign in
          </a>
        </div>
      </Container>
    </footer>
  );
}
