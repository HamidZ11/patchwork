import { Fragment } from 'react';
import { Breakable } from './breakable';

/**
 * Technical tokens inside prose: a package at a version (`stripe@18.5.0`),
 * a file path with an extension (`src/billing/schedules.ts`, so prose such
 * as "and/or" stays prose), a quoted literal (`'expired'`),
 * a dotted API path (`Invoice.parent.subscription_details.subscription`,
 * `invoices.retrieve()`) or a bare version (`v18.0.0`). The groups are tried
 * in that order, so a versioned package or a path is one token rather than
 * several. No token ends in `.`, so sentence punctuation stays prose.
 */
const TECHNICAL =
  /([a-z][\w-]*@\d+\.\d+\.\d+|(?:[\w-]+\/)+[\w-]+(?:\.[\w-]+)+|'[^'\s]+'|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\(\))?|\bv?\d+\.\d+\.\d+\b)/;

/**
 * Prose with its technical names set in mono, so an API path reads as a
 * name rather than as more words (DESIGN.md Amendment B10). Presentation
 * only: the text is unchanged, character for character, and every part
 * keeps the `.`/`_` line-break opportunities of `Breakable`.
 */
export function TechText({
  text,
  codeClassName = 'text-fg',
}: {
  text: string;
  /** Extra classes for the mono runs, e.g. a lighter weight inside a heading. */
  codeClassName?: string;
}) {
  return text.split(TECHNICAL).map((part, i) =>
    // `split` with one capturing group puts each match at an odd index.
    i % 2 === 1 ? (
      <code key={i} className={`font-mono text-[0.875em] ${codeClassName}`}>
        <Breakable text={part} />
      </code>
    ) : (
      <Fragment key={i}>
        <Breakable text={part} />
      </Fragment>
    ),
  );
}
