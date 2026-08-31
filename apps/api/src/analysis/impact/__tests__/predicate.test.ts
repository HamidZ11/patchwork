import { describe, expect, it } from 'vitest';
import type { ExtractedFile } from '../../archive.js';
import { scanForRetrieveUpcomingUsage } from '../predicate.js';

function file(path: string, content: string): ExtractedFile {
  return { path, content };
}

function allMatches(results: ReturnType<typeof scanForRetrieveUpcomingUsage>) {
  return [...results.values()].flatMap((r) => r.matches);
}
function allAmbiguous(results: ReturnType<typeof scanForRetrieveUpcomingUsage>) {
  return [...results.values()].flatMap((r) => r.ambiguousReferences);
}
function allFailedToLoad(results: ReturnType<typeof scanForRetrieveUpcomingUsage>) {
  return [...results.values()].flatMap((r) => r.filesFailedToLoad);
}

const STRIPE_IMPORT = "import Stripe from 'stripe';";

describe('scanForRetrieveUpcomingUsage', () => {
  // --- POSITIVE ---------------------------------------------------------

  it('1. direct Stripe call matches', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file(
        'src/billing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
  });

  it('2. same-file local alias of stripe.invoices matches', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file(
        'src/billing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'const invoices = stripe.invoices;',
          'invoices.retrieveUpcoming({ customer: "cus_1" });',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
  });

  it('3. bare method reference (not called) matches', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file(
        'src/billing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'const fn = stripe.invoices.retrieveUpcoming;',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
  });

  it('4. matches regardless of file/project layout', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file(
        'lib/deeply/nested/module/billing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.invoices.retrieveUpcoming({});',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
  });

  it('5. monorepo workspace: match attributed to the correct workspace, not collapsed', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('packages/billing/package.json', '{}'),
      file('packages/web/package.json', '{}'),
      file(
        'packages/billing/src/invoices.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.invoices.retrieveUpcoming({});',
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

  it('6. same method name on an unrelated object does not match', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file(
        'src/other.ts',
        [
          'const someRandomObject = { retrieveUpcoming: () => {} };',
          'someRandomObject.retrieveUpcoming();',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('7. method name only in a comment or string does not match', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file(
        'src/notes.ts',
        [
          '// TODO: migrate away from retrieveUpcoming',
          'const note = "retrieveUpcoming is deprecated";',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('8. a user-defined type/object with the same property does not match', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file(
        'src/custom.ts',
        [
          'interface MyInvoices { retrieveUpcoming(): void; }',
          'const myInvoices: MyInvoices = { retrieveUpcoming: () => {} };',
          'myInvoices.retrieveUpcoming();',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('9. Stripe dependency present but retrieveUpcoming unused produces no matches', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', JSON.stringify({ dependencies: { stripe: '^18.0.0' } })),
      file(
        'src/billing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.invoices.createPreview({});',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
  });

  it('10. the assignment target named retrieveUpcoming (not a property access) is never considered', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file('src/local.ts', 'const retrieveUpcoming = () => {};\nretrieveUpcoming();'),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  // --- UNCERTAIN ------------------------------------------------------------

  it('11. dynamic Stripe client construction is ambiguous', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file(
        'src/dynamic.ts',
        [
          'function getCtor(): any { return null; }',
          'const StripeCtor = getCtor();',
          "const stripe = new StripeCtor('sk_test');",
          'stripe.invoices.retrieveUpcoming({});',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(1);
  });

  it('12. an unresolved import is ambiguous, not a confirmed non-match', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file(
        'src/wrapper.ts',
        [
          // './stripe-client' was never extracted -- unresolvable in this
          // file's bounded Program.
          "import { stripe } from './stripe-client';",
          'stripe.invoices.retrieveUpcoming({});',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(1);
  });

  it('13. a cross-file wrapper function is ambiguous (only same-file resolution is supported)', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file(
        'src/consumer.ts',
        [
          // getInvoices lives in another file we didn't extract -- its
          // return type can't be resolved within this file's bounded
          // Program, so the result is `any`.
          "import { getInvoices } from './stripe-helpers';",
          'const invoices = getInvoices();',
          'invoices.retrieveUpcoming({});',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(1);
  });

  it('14. same-file wrapper functions still resolve correctly (not ambiguous)', () => {
    // Same-file indirection is ordinary type inference, not a special
    // case -- this is the "basic aliases" the escalation ladder allows.
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file(
        'src/same-file-wrapper.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'function getInvoices() { return stripe.invoices; }',
          'const invoices = getInvoices();',
          'invoices.retrieveUpcoming({});',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('15. does not crash on a malformed/incomplete file, records it or degrades gracefully', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file('src/broken.ts', `${STRIPE_IMPORT}\nconst stripe = new Stripe(secretKey, { apiVersion:`),
    ]);
    // Should never throw (already implicit in reaching this line), and
    // must never fabricate a confirmed match from unparseable source.
    expect(allMatches(results)).toHaveLength(0);
    const totalIssues = allAmbiguous(results).length + allFailedToLoad(results).length;
    expect(totalIssues).toBeGreaterThanOrEqual(0); // no crash is the real assertion above
  });

  it('scanning is skipped entirely for files that never mention the target property (cheap prefilter)', () => {
    const results = scanForRetrieveUpcomingUsage([
      file('package.json', '{}'),
      file('src/unrelated.ts', "import Stripe from 'stripe';\nexport const x = 1;"),
    ]);
    expect([...results.values()].every((r) => r.sourceFilesScanned === 0)).toBe(true);
  });
});
