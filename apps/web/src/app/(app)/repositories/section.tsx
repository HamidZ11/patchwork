/** The page container both repository pages share, so the index and a
 * repository's overview sit on the same column and rhythm. */
export const PAGE_MAIN = 'mx-auto w-full max-w-300 flex-1 px-4 pt-12 pb-24 sm:px-6 lg:px-8';

/** The two-column grid under a page header: content, then a sticky context
 * sidebar from `lg` (DESIGN.md Amendment B5). */
export const PAGE_GRID =
  'mt-10 grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_18.5rem]';

/** A plain heading with a count over one `bg-panel` window. */
export function Section({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 flex items-baseline gap-2 px-1 text-ui font-medium text-fg">
        {title}
        <span className="text-fg-tertiary tabular-nums">{count}</span>
      </h2>
      <div className="overflow-hidden rounded-window bg-panel shadow-card">{children}</div>
    </section>
  );
}
