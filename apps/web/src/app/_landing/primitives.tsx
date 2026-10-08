import Image from 'next/image';

/**
 * Landing-page primitives.
 *
 * Deliberately few and deliberately small: this page needs a container, a
 * section header, a framed screenshot and its two calls to action -- not a
 * component library. Everything else is composed inline in `page.tsx`,
 * because a landing page's value is in its specific composition, and
 * abstracting each section into a configurable component is what turns a
 * designed page into a template.
 */

export function Container({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

/**
 * A numbered section eyebrow. Neutral on purpose (DESIGN.md Amendment B11):
 * amber means Affected in the product, so the page that teaches a reader
 * what amber means does not spend it on decoration.
 */
export function SectionEyebrow({ index, label }: { index: string; label: string }) {
  return (
    <p className="flex items-center gap-2.5 font-mono text-2xs tracking-widest uppercase">
      <span className="text-fg-secondary">{index}</span>
      <span className="text-fg-tertiary">{label}</span>
    </p>
  );
}

const CTA_BASE =
  'inline-flex h-11 items-center justify-center rounded-control px-5 text-sm font-semibold transition-[background-color,scale] duration-150 ease-out-strong focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none active:scale-[0.97] motion-reduce:active:scale-100';

/** The product's own button recipes (Amendment B6) at the landing page's
 * larger size: a near-white primary, a tactile secondary with the lit edge. */
export const CTA_PRIMARY = `${CTA_BASE} bg-accent text-accent-fg hover:bg-accent-hover`;
export const CTA_SECONDARY = `${CTA_BASE} bg-surface text-fg shadow-btn hover:bg-evidence`;

interface Capture {
  src: string;
  /** Intrinsic pixel size of the capture; only the ratio matters for layout. */
  width: number;
  height: number;
}

/**
 * A real product screenshot, framed the way the product frames a panel
 * (`rounded-window`, `shadow-card`). Every capture is of the shipping UI
 * with real data -- never sample data.
 *
 * `mobile` is a separate, tighter capture taken at phone width rather than
 * the desktop capture shrunk: a 1440px screen fitted into a 350px column
 * renders its text at a few pixels, a screenshot of a screenshot rather
 * than evidence. Below `sm` only the mobile capture renders; a lazy image
 * that is `display: none` is never fetched.
 */
export function ProductShot({
  desktop,
  mobile,
  alt,
  priority = false,
  className = '',
}: {
  desktop: Capture;
  mobile?: Capture;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-window bg-canvas shadow-card ${className}`}>
      <Image
        src={desktop.src}
        width={desktop.width}
        height={desktop.height}
        alt={alt}
        priority={priority}
        sizes="(max-width: 1280px) 92vw, 1150px"
        className={`h-auto w-full ${mobile ? 'hidden sm:block' : ''}`}
      />
      {mobile && (
        <Image
          src={mobile.src}
          width={mobile.width}
          height={mobile.height}
          alt={alt}
          priority={priority}
          sizes="100vw"
          className="h-auto w-full sm:hidden"
        />
      )}
    </div>
  );
}
