/**
 * The three control treatments (DESIGN.md Amendment B6): 32px tall, control
 * radius, 13px medium labels, a cool-grey focus ring, and a 0.97 press scale
 * so a click is felt before the server answers (removed under reduced
 * motion). Primary is the near-white fill; secondary is tactile -- a surface
 * fill with the lit `shadow-btn` edge, never an outlined box; quiet is text
 * until hovered.
 */
const base =
  'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-control px-3 text-ui font-medium transition-[background-color,color,scale] duration-150 ease-out-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100';

export const buttonVariantClassName = {
  primary: `${base} bg-accent text-accent-fg hover:bg-accent-hover`,
  secondary: `${base} bg-surface text-fg shadow-btn hover:bg-evidence`,
  quiet: `${base} px-2.5 text-fg-secondary hover:bg-surface hover:text-fg`,
} as const;
