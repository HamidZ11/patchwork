import Image from 'next/image';

/**
 * Landing-page primitives.
 *
 * Deliberately few and deliberately small: this page needs a container, a
 * section header, a framed screenshot and a rule -- not a component library.
 * Everything else is composed inline in `page.tsx`, because a landing page's
 * value is in its specific composition, and abstracting each section into a
 * configurable component is what turns a designed page into a template.
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
 * A numbered section eyebrow. The numeral is the only place the landing accent
 * appears in running text -- it marks the spine of the argument (01 problem →
 * 07 trust) without colouring a single word of the prose.
 */
export function SectionEyebrow({ index, label }: { index: string; label: string }) {
  return (
    <p className="flex items-center gap-2.5 font-mono text-2xs tracking-widest uppercase">
      <span className="text-landing-accent">{index}</span>
      <span className="text-fg-faint">{label}</span>
    </p>
  );
}

/**
 * A real product screenshot, framed the way the product frames its own
 * evidence surfaces: one hairline rule, the same `rounded-md`, no browser
 * chrome, no perspective, no drop shadow. `focusRegion` selects which part of
 * the capture is shown -- the screenshots are full 3024px window captures and
 * most of them carry dead space that would shrink the interesting region to
 * nothing if the whole frame were fitted.
 */
export function ProductShot({
  src,
  alt,
  ratio,
  mobileRatio,
  zoom = 1,
  priority = false,
  className = '',
}: {
  src: string;
  alt: string;
  /** Aspect ratio of the visible window onto the capture at `sm` and above. */
  ratio: string;
  /** A taller window at mobile, so a zoomed region still has room to breathe. */
  mobileRatio?: string;
  /**
   * How much larger than its frame the capture is drawn at mobile. A full
   * 2310px-wide capture fitted into a 348px column renders its body text at
   * about five pixels, which is a screenshot of a screenshot rather than
   * evidence. Above `sm` this is always 1 -- the whole capture fits and
   * zooming would crop the argument.
   */
  zoom?: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative isolate overflow-hidden rounded-md border border-rule bg-canvas [--shot-ratio:var(--m-ratio)] [--shot-zoom:var(--m-zoom)] sm:[--shot-ratio:var(--d-ratio)] sm:[--shot-zoom:1] ${className}`}
      style={
        {
          '--d-ratio': ratio,
          '--m-ratio': mobileRatio ?? ratio,
          '--m-zoom': String(zoom),
          aspectRatio: 'var(--shot-ratio)',
        } as React.CSSProperties
      }
    >
      {/* The zoom is applied by oversizing an inner layer and anchoring it
          top-left, so the frame keeps its own aspect ratio and the capture is
          simply clipped by it -- no transform, no distortion. */}
      <div
        className="absolute top-0 left-0"
        style={{ width: 'calc(100% * var(--shot-zoom))', height: 'calc(100% * var(--shot-zoom))' }}
      >
        <Image
          src={src}
          alt={alt}
          fill
          priority={priority}
          sizes="(max-width: 640px) 200vw, (max-width: 1280px) 90vw, 1150px"
          className="object-cover object-left-top"
        />
      </div>
    </div>
  );
}
