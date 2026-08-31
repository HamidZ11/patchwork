import { describe, expect, it } from 'vitest';
import type { ExtractedFile } from '../../../archive.js';
import { scanForLiteralComparison } from '../literal-comparison.js';

function file(path: string, content: string): ExtractedFile {
  return { path, content };
}

function scan(files: ExtractedFile[]) {
  return scanForLiteralComparison(files, {
    propertyName: 'status',
    literalValue: 'reversed',
    matchedSymbol: "authorization.status === 'reversed'",
  });
}

function allMatches(results: ReturnType<typeof scan>) {
  return [...results.values()].flatMap((r) => r.matches);
}
function allAmbiguous(results: ReturnType<typeof scan>) {
  return [...results.values()].flatMap((r) => r.ambiguousReferences);
}

const STRIPE_IMPORT = "import Stripe from 'stripe';";

describe('scanForLiteralComparison (issuing authorization status case)', () => {
  // --- POSITIVE ---------------------------------------------------------

  it("1. direct comparison against 'reversed' matches", () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/issuing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          "const authorization = await stripe.issuing.authorizations.retrieve('iauth_1');",
          "if (authorization.status === 'reversed') { /* handle it */ }",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
  });

  it('2. same-file local alias of the authorization still matches', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/issuing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          "const authorization = await stripe.issuing.authorizations.retrieve('iauth_1');",
          'const auth = authorization;',
          "if (auth.status === 'reversed') { /* handle it */ }",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
  });

  it('3. the literal-first comparison order (reversed === status) also matches', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/issuing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          "const authorization = await stripe.issuing.authorizations.retrieve('iauth_1');",
          "if ('reversed' === authorization.status) { /* handle it */ }",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
  });

  it('4. multiple comparisons in one file each produce a finding', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/issuing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          "const a = await stripe.issuing.authorizations.retrieve('iauth_1');",
          "const b = await stripe.issuing.authorizations.retrieve('iauth_2');",
          "if (a.status === 'reversed') { /* handle it */ }",
          "if (b.status === 'reversed') { /* handle it */ }",
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
        'packages/billing/src/issuing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          "const authorization = await stripe.issuing.authorizations.retrieve('iauth_1');",
          "if (authorization.status === 'reversed') { /* handle it */ }",
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

  it('6. the same property name on an unrelated object does not match', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/other.ts',
        [
          'const job = { status: "reversed" as string };',
          'if (job.status === "reversed") { /* not stripe at all */ }',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it("7. 'reversed' only in a comment or string does not match", () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/notes.ts',
        [
          '// authorizations used to report reversed instead of expired',
          'const note = "status can be reversed";',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('8. Stripe present but comparing status against a different literal does not match', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/issuing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          "const authorization = await stripe.issuing.authorizations.retrieve('iauth_1');",
          "if (authorization.status === 'closed') { /* different value, not this rule's concern */ }",
          '// reversed appears here only so the prefilter still scans this file',
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('9. a user-defined type with the same property/literal does not match', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/custom.ts',
        [
          "interface MyAuthorization { status: 'reversed' | 'closed'; }",
          "const authorization: MyAuthorization = { status: 'reversed' };",
          "if (authorization.status === 'reversed') { /* not stripe */ }",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  // --- UNCERTAIN ------------------------------------------------------------

  it('10. dynamic Stripe client construction is ambiguous', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/dynamic.ts',
        [
          'function getCtor(): any { return null; }',
          'const StripeCtor = getCtor();',
          "const stripe = new StripeCtor('sk_test');",
          "const authorization = await stripe.issuing.authorizations.retrieve('iauth_1');",
          "if (authorization.status === 'reversed') { /* handle it */ }",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(1);
  });

  it('11. an unresolved import is ambiguous, not a confirmed non-match', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/wrapper.ts',
        [
          "import { authorization } from './issuing-client';",
          "if (authorization.status === 'reversed') { /* handle it */ }",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(1);
  });

  it('12. a cross-file wrapper function is ambiguous (only same-file resolution is supported)', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/consumer.ts',
        [
          "import { getAuthorization } from './issuing-helpers';",
          'const authorization = getAuthorization();',
          "if (authorization.status === 'reversed') { /* handle it */ }",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(1);
  });

  it('13. same-file wrapper functions still resolve correctly (not ambiguous)', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/same-file-wrapper.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          "function getAuthorization() { return stripe.issuing.authorizations.retrieve('iauth_1'); }",
          'const authorization = await getAuthorization();',
          "if (authorization.status === 'reversed') { /* handle it */ }",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('scanning is skipped entirely for files that never mention the property AND the literal (cheap prefilter)', () => {
    const results = scan([
      file('package.json', '{}'),
      file('src/unrelated.ts', "import Stripe from 'stripe';\nexport const x = 1;"),
    ]);
    expect([...results.values()].every((r) => r.sourceFilesScanned === 0)).toBe(true);
  });

  // --- DESTRUCTURING (slice 5 realistic-validation fix) --------------------
  // Confirmed real gap: a destructured comparison operand is a plain
  // Identifier, never a PropertyAccessExpression, so it was invisible to
  // this predicate before this fix -- found via slice 5's realistic
  // validation, not hypothesized.

  it('14. a same-file destructured comparison matches', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/issuing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          "const { status } = await stripe.issuing.authorizations.retrieve('iauth_1');",
          "if (status === 'reversed') { /* handle it */ }",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('15. a renamed destructured comparison still matches', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/issuing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          "const { status: authStatus } = await stripe.issuing.authorizations.retrieve('iauth_1');",
          "if (authStatus === 'reversed') { /* handle it */ }",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(1);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('16. a destructured comparison from an unrelated object is a confirmed non-match', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/other.ts',
        [
          "const job = { status: 'reversed' as string };",
          'const { status } = job;',
          "const wasReversed = status === 'reversed';",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(0);
  });

  it('17. a destructured comparison from a dynamic/unresolvable source is ambiguous', () => {
    const results = scan([
      file('package.json', '{}'),
      file(
        'src/dynamic.ts',
        [
          'function getCtor(): any { return null; }',
          'const stripe = getCtor();',
          "const { status } = await stripe.issuing.authorizations.retrieve('iauth_1');",
          "if (status === 'reversed') { /* handle it */ }",
        ].join('\n'),
      ),
    ]);
    expect(allMatches(results)).toHaveLength(0);
    expect(allAmbiguous(results)).toHaveLength(1);
  });
});
