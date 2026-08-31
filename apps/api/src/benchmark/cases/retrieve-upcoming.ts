import type { BenchmarkCase } from '../types.js';
import { STRIPE_IMPORT, packageJsonWithStripe, packageLockWithStripe } from './fixture-helpers.js';

const RULE_ID = 'basil-2025-03-31-invoice-preview-api-deprecations';

export const RETRIEVE_UPCOMING_CASES: BenchmarkCase[] = [
  // --- POSITIVE -----------------------------------------------------------
  {
    id: 'retrieve-upcoming-positive-direct-call',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
      ].join('\n'),
    },
    expected: {
      status: 'AFFECTED',
      findingCount: 1,
      findingLocations: [{ sourceFile: 'src/billing.ts', line: 3 }],
    },
    notes: 'Direct, obvious usage of the removed method on an applicable SDK version.',
  },
  {
    id: 'retrieve-upcoming-positive-local-alias',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'const invoices = stripe.invoices;',
        'invoices.retrieveUpcoming({ customer: "cus_1" });',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes: 'A common one-hop local indirection should still resolve to the stub.',
  },
  {
    id: 'retrieve-upcoming-positive-multiple-usages',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
        'stripe.invoices.retrieveUpcoming({ customer: "cus_2" });',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 2 },
    notes: 'Multiple affected usages in one file must each produce their own finding.',
  },
  {
    id: 'retrieve-upcoming-positive-nested-workspace',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    files: {
      'packages/billing/package.json': packageJsonWithStripe('^18.0.0'),
      'packages/billing/package-lock.json': packageLockWithStripe('18.2.0'),
      'packages/billing/src/invoices.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
      ].join('\n'),
      'packages/web/package.json': JSON.stringify({ dependencies: {} }),
      'packages/web/src/index.ts': 'export const x = 1;',
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes: 'A monorepo workspace with the affected usage should still resolve to AFFECTED.',
  },

  // --- NEGATIVE -------------------------------------------------------------
  {
    id: 'retrieve-upcoming-negative-unrelated-object',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'const legacyInvoices = { retrieveUpcoming: () => {} };',
        'legacyInvoices.retrieveUpcoming();',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'Same method name on an unrelated object must be rejected, not just lexically matched.',
  },
  {
    id: 'retrieve-upcoming-negative-comment-only',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/notes.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '// TODO: we used to call retrieveUpcoming here, migrated already',
        'const note = "retrieveUpcoming is deprecated";',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'The identifier appearing only in a comment/string is not a usage.',
  },
  {
    id: 'retrieve-upcoming-negative-feature-unused',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'stripe.invoices.createPreview({ customer: "cus_1" });',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'Stripe is present and applicable, but the repository already uses the replacement.',
  },
  {
    id: 'retrieve-upcoming-negative-pre-boundary-api-version',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    files: {
      'package.json': packageJsonWithStripe('^17.0.0'),
      'package-lock.json': packageLockWithStripe('17.7.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: '2024-06-20.acacia' });",
        'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes:
      'Structurally identical to the positive case, but an explicit pre-Basil apiVersion pin ' +
      'is a legitimate negative proof on its own -- applicability wins over the predicate.',
  },

  // --- UNCERTAIN --------------------------------------------------------------
  {
    id: 'retrieve-upcoming-uncertain-dynamic-construction',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/dynamic.ts': [
        'function getCtor(): any { return null; }',
        'const StripeCtor = getCtor();',
        "const stripe = new StripeCtor('sk_test');",
        'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes: 'Dynamic client construction cannot be proven to originate from the stub either way.',
  },
  {
    id: 'retrieve-upcoming-uncertain-unresolved-import',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/wrapper.ts': [
        "import { stripe } from './stripe-client';",
        'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes: "The import target ('./stripe-client') was never extracted, so it can't be resolved.",
  },
  {
    id: 'retrieve-upcoming-uncertain-unknown-version',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    files: {
      // No lockfile at all -- the SDK version can only be DECLARED_ONLY,
      // and there's no explicit apiVersion evidence either.
      'package.json': packageJsonWithStripe('^18.0.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes:
      'Applicability is genuinely UNKNOWN with no resolvable SDK version -- must abstain even ' +
      'though the predicate found a confirmed match.',
  },
];
