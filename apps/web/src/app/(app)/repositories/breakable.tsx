import { Fragment } from 'react';

/** Change titles name API paths (`Invoice.parent.subscription_details.
 * subscription`). Offer a line break after each `.` and `_` so a narrow
 * column wraps at a segment, not mid-word. The text itself is unchanged:
 * `<wbr>` adds a break opportunity, never a character. */
export function Breakable({ text }: { text: string }) {
  return text.split(/(?<=[._])/).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}
