import type { ImpactStateKind } from './repository-state';

const BLOCK_A = 'M2 2h20v6h-8v6H8v8H2V2Z';
const BLOCK_B = 'M22 10h-6v6h-6v6h12V10Z';

const COLOUR: Record<ImpactStateKind, string> = {
  affected: 'text-mark-attention',
  uncertain: 'text-mark-indeterminate',
  clear: 'text-mark-success',
  failed: 'text-mark-failure',
  not_assessed: 'text-fg-tertiary',
  not_analysed: 'text-mark-neutral',
};

/**
 * A repository's verdict as the Patchwork mark (DESIGN.md Amendment B4).
 * Shape carries the state as well as colour, so no two states differ by hue
 * alone:
 *   affected      whole mark, solid -- the patch is needed
 *   uncertain     one block solid, one open -- half the evidence
 *   clear         whole mark, outlined -- intact, nothing to patch
 *   failed        the two blocks pulled apart at the joint
 *   not_assessed  one block outlined, one dashed -- ran, never assessed
 *   not_analysed  both dashed -- nothing known yet
 * Decorative: the verdict word beside it is the accessible statement.
 */
export function PatchGlyph({ kind }: { kind: ImpactStateKind }) {
  const solid = { fill: 'currentColor', stroke: 'none' };
  const open = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.25 };
  const dashed = { ...open, strokeDasharray: '3 2.5' };
  const parts: Record<ImpactStateKind, [object, object, string?]> = {
    affected: [solid, solid],
    uncertain: [solid, open],
    clear: [open, open],
    failed: [solid, solid, 'translate(2.5 2.5)'],
    not_assessed: [open, dashed],
    not_analysed: [dashed, dashed],
  };
  const [a, b, shift] = parts[kind];
  return (
    <svg viewBox="-1 -1 28 28" aria-hidden="true" className={`size-4 shrink-0 ${COLOUR[kind]}`}>
      <path d={BLOCK_A} {...a} />
      <path d={BLOCK_B} transform={shift} {...b} />
    </svg>
  );
}
