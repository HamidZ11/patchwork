/** A status dot plus its label (DESIGN.md Section 22). The dot reinforces
 * the label and never carries the status alone, so it is `aria-hidden`. */
export function StatusMark({
  label,
  style,
  className = '',
}: {
  label: string;
  style: { dot: string; text: string };
  className?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${style.text} ${className}`}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${style.dot}`} />
      <span className="truncate">{label}</span>
    </span>
  );
}
