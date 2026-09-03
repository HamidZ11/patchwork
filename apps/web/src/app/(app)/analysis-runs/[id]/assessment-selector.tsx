'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * One selectable provider change. Everything except `report` is plain
 * serializable data computed on the server -- status precedence, verdict
 * copy, the evidence count and the ordering are all decided there, so this
 * component holds no product logic beyond "which id is selected".
 *
 * `report` is a fully server-rendered React element handed down as a prop.
 * That is what keeps the whole evidence chain (and every `'use server'`
 * action bound inside it) on the server: this client component only decides
 * which pre-rendered element to place in the panel, it never re-creates one.
 */
export interface AssessmentTab {
  id: string;
  title: string;
  statusLabel: string;
  statusDotClassName: string;
  statusTextClassName: string;
  /** Only set where a count is real and unambiguous -- an AFFECTED
   * assessment with confirmed findings. Null everywhere else so the row
   * never implies "zero usages found" for a verdict that did not conclude
   * that (an UNCERTAIN change reads simply "Uncertain"). */
  evidenceLabel: string | null;
  report: ReactNode;
}

/**
 * ARIA tabs, vertical orientation, automatic activation: arrow keys move
 * selection and focus together, which the APG permits because every panel
 * is already present in the page payload -- there is nothing to fetch, so
 * moving through them cannot cause a slow or surprising load.
 */
export function AssessmentSelector({
  items,
  defaultSelectedId,
}: {
  items: AssessmentTab[];
  defaultSelectedId: string;
}) {
  const [selectedId, setSelectedId] = useState(defaultSelectedId);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Falls back to the first item rather than rendering an empty panel if a
  // selected id ever goes missing (e.g. the run is re-fetched with a
  // different assessment set while this component stays mounted).
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  if (!selected) return null;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = items.findIndex((item) => item.id === selected.id);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;

    if (nextIndex === null) return;
    event.preventDefault();
    const next = items[nextIndex];
    setSelectedId(next.id);
    tabRefs.current[next.id]?.focus();
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="Provider changes in this analysis"
        className="flex flex-col divide-y divide-rule overflow-hidden rounded-md border border-rule"
      >
        {items.map((item, index) => {
          const isSelected = item.id === selected.id;
          return (
            <button
              key={item.id}
              ref={(element) => {
                tabRefs.current[item.id] = element;
              }}
              type="button"
              role="tab"
              id={`assessment-tab-${item.id}`}
              aria-selected={isSelected}
              aria-controls={`assessment-panel-${item.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelectedId(item.id)}
              onKeyDown={onKeyDown}
              // Deliberately no `transition-colors`. The selected state is carried by
              // `border-left-color` and `background-color`, both animatable, while
              // `font-weight` is not -- so transitioning them made the outgoing row
              // keep a visible rail and tint for the transition's duration while the
              // title weight had already snapped to the new row. Two rows appeared
              // selected at once, by different signals. Selection is a discrete
              // change of which record you are reading, not a movement; it applies
              // instantly, and hover applies instantly with it.
              className={`flex min-w-0 items-start gap-3 border-l-2 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-inset focus-visible:outline-none sm:px-5 ${
                isSelected
                  ? 'border-l-fg bg-surface'
                  : 'border-l-transparent hover:bg-surface-hover'
              }`}
            >
              <span
                aria-hidden="true"
                className="pt-0.5 font-mono text-2xs tabular-nums text-fg-faint"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span
                  className={`text-sm leading-5 ${
                    isSelected ? 'font-semibold text-fg' : 'font-medium text-fg-secondary'
                  }`}
                >
                  {item.title}
                </span>
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                  <span
                    className={`inline-flex items-center gap-1.5 font-medium ${item.statusTextClassName}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.statusDotClassName}`}
                      aria-hidden="true"
                    />
                    {item.statusLabel}
                  </span>
                  {item.evidenceLabel && (
                    <>
                      <span aria-hidden="true" className="text-fg-faint">
                        ·
                      </span>
                      <span className="font-mono text-2xs text-fg-tertiary">
                        {item.evidenceLabel}
                      </span>
                    </>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* No `tabIndex` on the panel: the APG only calls for it when a panel
          holds no focusable content, and every report contains at least its
          provider-changelog link. */}
      <div
        role="tabpanel"
        id={`assessment-panel-${selected.id}`}
        aria-labelledby={`assessment-tab-${selected.id}`}
        className="min-w-0"
      >
        {selected.report}
      </div>
    </div>
  );
}
