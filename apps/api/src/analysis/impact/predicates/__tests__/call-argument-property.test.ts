import { describe, expect, it } from 'vitest';
import type { ExtractedFile } from '../../../archive.js';
import { scanForCallArgumentProperty } from '../call-argument-property.js';

function file(path: string, content: string): ExtractedFile {
  return { path, content };
}

function scan(files: ExtractedFile[]) {
  return scanForCallArgumentProperty(files, {
    methodNames: ['create', 'update'],
    argumentPropertyName: 'iterations',
    matchedSymbol: 'stripe.subscriptionSchedules.{create,update}({ phases: [{ iterations }] })',
  });
}

function allMatches(results: ReturnType<typeof scan>) {
  return [...results.values()].flatMap((r) => r.matches);
}
function allAmbiguous(results: ReturnType<typeof scan>) {
  return [...results.values()].flatMap((r) => r.ambiguousReferences);
}

const STRIPE_IMPORT = "import Stripe from 'stripe';";

describe('scanForCallArgumentProperty (schedule iterations case)', () => {
  // --- POSITIVE ---------------------------------------------------------

  it('1. direct create() call with an iterations phase matches', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/schedules.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.subscriptionSchedules.create({ phases: [{ iterations: 3 }] });',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
  });

  it('2. same-file local alias of subscriptionSchedules matches', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/schedules.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'const schedules = stripe.subscriptionSchedules;',
          'schedules.create({ phases: [{ iterations: 3 }] });',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
  });

  it('3. update() calls are matched too, not just create()', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/schedules.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          "stripe.subscriptionSchedules.update('sub_sched_1', { phases: [{ iterations: 2 }] });",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
  });

  it('4. multiple affected calls in one file each produce a finding', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/schedules.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.subscriptionSchedules.create({ phases: [{ iterations: 3 }] });',
          "stripe.subscriptionSchedules.update('sub_sched_1', { phases: [{ iterations: 1 }] });",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(2);
  });

  it('5. monorepo workspace: match attributed to the correct workspace', () => {
    const results = scan([
      file('packages/billing/package.json', '{}'),
      file('packages/web/package.json', '{}'),
      file(
        'packages/billing/src/schedules.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.subscriptionSchedules.create({ phases: [{ iterations: 3 }] });',
        ].join('\n'),
      ),
      file('packages/web/src/index.ts', 'export const x = 1;'),
    ]);
    const billing = results.get('packages/billing');
    const web = results.get('packages/web');
    expect(billing?.matches).toHaveLength(1);
    expect(billing?.matches[0]?.workspacePath).toBe('packages/billing');
    expect(web?.matches ?? []).toHaveLength(0);
  });

  // --- NEGATIVE -----------------------------------------------------------

  it('6. the same method name + property on an unrelated object does not match', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/other.ts',
        [
          'const scheduler = { create: (p: unknown) => p };',
          'scheduler.create({ phases: [{ iterations: 3 }] });',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('7. iterations only in a comment or string does not match', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/notes.ts',
        [
          '// TODO: migrate away from the iterations parameter',
          'const note = "iterations is deprecated";',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('8. Stripe present but iterations unused (create() without it) produces no matches, not ambiguous', () => {
    const results = scan([
      file('package.json', JSON.stringify({ dependencies: { stripe: '^19.0.0' } })),
      file(
        'src/schedules.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          // 'iterations' appears only in a comment, so the cheap prefilter
          // still lets the file through, but the real create() call below
          // uses duration instead -- a genuinely unused feature.
          '// iterations was removed in favor of duration',
          "stripe.subscriptionSchedules.create({ phases: [{ duration: 'month' }] });",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('9. a different method name with the same argument shape is never considered', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/schedules.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          "stripe.subscriptionSchedules.retrieve('sub_sched_1', { iterations: 3 } as never);",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  // --- UNCERTAIN ------------------------------------------------------------

  it('10. dynamic Stripe client construction with iterations present is ambiguous', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/dynamic.ts',
        [
          'function getCtor(): any { return null; }',
          'const StripeCtor = getCtor();',
          "const stripe = new StripeCtor('sk_test');",
          'stripe.subscriptionSchedules.create({ phases: [{ iterations: 3 }] });',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(1);
  });

  it('11. an unresolved import with iterations present is ambiguous, not a confirmed non-match', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/wrapper.ts',
        [
          "import { stripe } from './stripe-client';",
          'stripe.subscriptionSchedules.create({ phases: [{ iterations: 3 }] });',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(1);
  });

  it('12. an unresolved callee with no matching property is not interesting, not ambiguous', () => {
    // An unrelated dynamic call happens to be named create() and mentions
    // iterations only in a sibling statement -- there is nothing in this
    // specific call's arguments to be uncertain about.
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/wrapper.ts',
        [
          "import { scheduler } from './scheduler-client';",
          '// iterations handled elsewhere',
          "scheduler.create({ phases: [{ duration: 'month' }] });",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('13. same-file wrapper functions still resolve correctly (not ambiguous)', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/same-file-wrapper.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'function getSchedules() { return stripe.subscriptionSchedules; }',
          'const schedules = getSchedules();',
          'schedules.create({ phases: [{ iterations: 3 }] });',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('scanning is skipped entirely for files that never mention the target argument property (cheap prefilter)', () => {
    const results = scan([
      file('package.json', '{}'),
      file('src/unrelated.ts', "import Stripe from 'stripe';\nexport const x = 1;"),
    ]);
    expect([...results.values()].every((r) => r.sourceFilesScanned === 0)).toBe(true);
  });
});
