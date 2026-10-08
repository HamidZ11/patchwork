'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Breakable } from '../../repositories/breakable';

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
  /** The change's estate-wide number (`02`), the same one the repository
   * index and overview use. Falls back to list position when absent. */
  label?: string;
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
 *
 * Laid out like the repository index (DESIGN.md Amendment B8): the selected
 * report in the main column, the change list in a sticky sidebar with
 * `aside` beneath it. Below `lg` the sidebar wrapper dissolves (`contents`)
 * so the list comes before the report and `aside` after it -- a reader on a
 * phone picks a change before scrolling through one.
 */
export function AssessmentSelector({
  items,
  defaultSelectedId,
  heading,
  aside,
}: {
  items: AssessmentTab[];
  defaultSelectedId: string;
  /** Shown above the change list. */
  heading?: ReactNode;
  /** Context below the change list; after the report below `lg`. */
  aside?: ReactNode;
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
    <div className="flex min-w-0 flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-x-12 xl:grid-cols-[minmax(0,1fr)_18.5rem]">
      <div className="contents lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:flex lg:flex-col lg:gap-10">
        <div className="order-1 min-w-0">
          {heading}
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="Provider changes in this analysis"
            className={`-mx-2 flex flex-col gap-0.5 ${heading ? 'mt-3' : ''}`}
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
                  // Deliberately no transition. Selection is a discrete change of
                  // which record you are reading, not a movement: a fading surface
                  // left the outgoing row looking selected while the incoming one
                  // already was -- two rows selected at once. It applies
                  // instantly, and hover applies instantly with it.
                  className={`grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 rounded-control px-2 py-2 text-left focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                    isSelected ? 'bg-surface shadow-btn' : 'hover:bg-surface-hover'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="font-mono text-2xs leading-5 text-fg-tertiary tabular-nums"
                  >
                    {item.label ?? String(index + 1).padStart(2, '0')}
                  </span>
                  <span
                    className={`line-clamp-2 text-ui [overflow-wrap:anywhere] ${
                      isSelected ? 'text-fg' : 'text-fg-secondary'
                    }`}
                  >
                    <Breakable text={item.title} />
                  </span>
                  <span className="col-start-2 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                    <span
                      className={`inline-flex items-center gap-1.5 font-medium ${item.statusTextClassName}`}
                    >
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${item.statusDotClassName}`}
                        aria-hidden="true"
                      />
                      {item.statusLabel}
                    </span>
                    {item.evidenceLabel && (
                      <>
                        <span aria-hidden="true" className="text-fg-tertiary">
                          ·
                        </span>
                        <span className="text-fg-tertiary tabular-nums">{item.evidenceLabel}</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {aside && <div className="order-3 min-w-0">{aside}</div>}
      </div>

      {/* `key` is load-bearing, not a lint appeasement: it makes the panel the
          selected assessment's panel rather than one reusable container that
          happens to show different children.

          Every report has the same element shape, so without it React
          reconciles an incoming report onto the outgoing one's fibers at this
          position and any client state inside survives the switch. That is a
          correctness bug, not a cosmetic one -- `ExplainAssessment` kept its
          `useActionState` result, so an explanation generated for one
          assessment stayed on screen under the next one, for an assessment
          that had never requested one. Keying by assessment identity makes a
          selection change a remount, which is the only thing that can be true
          for a panel whose entire meaning is "this assessment".

          Deliberately here rather than on `ExplainAssessment` itself: the
          invariant is that a report's client state belongs to its assessment,
          which has to hold for every client component a report may contain,
          not just today's one.

          No `tabIndex` on the panel: the APG only calls for it when a panel
          holds no focusable content, and every report contains at least its
          provider-changelog link. */}
      <div
        key={selected.id}
        role="tabpanel"
        id={`assessment-panel-${selected.id}`}
        aria-labelledby={`assessment-tab-${selected.id}`}
        className="order-2 min-w-0 lg:col-start-1 lg:row-start-1"
      >
        {selected.report}
      </div>
    </div>
  );
}
