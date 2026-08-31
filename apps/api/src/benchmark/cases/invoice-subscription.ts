import type { BenchmarkCase } from '../types.js';
import { STRIPE_IMPORT, packageJsonWithStripe, packageLockWithStripe } from './fixture-helpers.js';

const RULE_ID = 'basil-2025-03-31-adds-new-parent-field-to-invoicing-objects';

export const INVOICE_SUBSCRIPTION_CASES: BenchmarkCase[] = [
  // --- POSITIVE -----------------------------------------------------------
  {
    id: 'invoice-subscription-positive-direct-access',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function getInvoiceSubscription(id: string) {',
        '  const invoice = await stripe.invoices.retrieve(id);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
    },
    expected: {
      status: 'AFFECTED',
      findingCount: 1,
      findingLocations: [{ sourceFile: 'src/billing.ts', line: 5 }],
    },
    notes:
      'Real stripe-node usage is async -- proves the ambient Promise stub lets await-unwrapped ' +
      'Invoice.subscription still resolve to real provenance, not just synchronous calls.',
  },
  {
    id: 'invoice-subscription-positive-local-alias',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function getInvoiceSubscription(id: string) {',
        '  const invoice = await stripe.invoices.retrieve(id);',
        '  const sameInvoice = invoice;',
        '  return sameInvoice.subscription;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes: 'A same-file local alias of the resolved Invoice object should still resolve.',
  },
  {
    id: 'invoice-subscription-positive-multiple-usages',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function report(id1: string, id2: string) {',
        '  const invoiceA = await stripe.invoices.retrieve(id1);',
        '  const invoiceB = await stripe.invoices.retrieve(id2);',
        '  return [invoiceA.subscription, invoiceB.subscription];',
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 2 },
    notes: 'Multiple affected usages in one file must each produce their own finding.',
  },
  {
    id: 'invoice-subscription-positive-nested-workspace',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'packages/billing/package.json': packageJsonWithStripe('^18.0.0'),
      'packages/billing/package-lock.json': packageLockWithStripe('18.2.0'),
      'packages/billing/src/invoices.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function getInvoiceSubscription(id: string) {',
        '  const invoice = await stripe.invoices.retrieve(id);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
      'packages/web/package.json': JSON.stringify({ dependencies: {} }),
      'packages/web/src/index.ts': 'export const x = 1;',
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes: 'A monorepo workspace with the affected usage should still resolve to AFFECTED.',
  },

  // --- NEGATIVE -------------------------------------------------------------
  {
    id: 'invoice-subscription-negative-unrelated-object',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        "const legacyRecord = { subscription: 'sub_123' };",
        'const value = legacyRecord.subscription;',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'Same property name on an unrelated object must be rejected.',
  },
  {
    id: 'invoice-subscription-negative-comment-only',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/notes.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '// invoice.subscription was removed, we migrated already',
        'const note = "subscription is deprecated on Invoice";',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'The identifier appearing only in a comment/string is not a usage.',
  },
  {
    id: 'invoice-subscription-negative-feature-unused',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '// subscriptionPlan is unrelated to Invoice.subscription',
        'async function getInvoiceId(id: string) {',
        '  const invoice = await stripe.invoices.retrieve(id);',
        "  const subscriptionPlan = 'unused';",
        '  return { invoiceId: id, subscriptionPlan };',
        '}',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'Stripe is present and applicable, but Invoice.subscription is genuinely never read.',
  },
  {
    id: 'invoice-subscription-negative-pre-boundary-api-version',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^17.0.0'),
      'package-lock.json': packageLockWithStripe('17.7.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: '2024-06-20.acacia' });",
        'async function getInvoiceSubscription(id: string) {',
        '  const invoice = await stripe.invoices.retrieve(id);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes:
      'Shares the same applicability boundary as the retrieveUpcoming rule -- proves the ' +
      'same ApplicabilityConfig genuinely generalizes across rules, not just in name.',
  },

  // --- UNCERTAIN --------------------------------------------------------------
  {
    id: 'invoice-subscription-uncertain-dynamic-construction',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/dynamic.ts': [
        'function getCtor(): any { return null; }',
        'const StripeCtor = getCtor();',
        "const stripe = new StripeCtor('sk_test');",
        'async function getInvoiceSubscription(id: string) {',
        '  const invoice = await stripe.invoices.retrieve(id);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes: 'Dynamic client construction cannot be proven to originate from the stub either way.',
  },
  {
    id: 'invoice-subscription-uncertain-unresolved-import',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/wrapper.ts': [
        "import { getInvoice } from './invoice-helpers';",
        'async function getInvoiceSubscription(id: string) {',
        '  const invoice = await getInvoice(id);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes: "getInvoice's return type lives in a file we never extracted -- unresolvable.",
  },
  {
    id: 'invoice-subscription-uncertain-unknown-version',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function getInvoiceSubscription(id: string) {',
        '  const invoice = await stripe.invoices.retrieve(id);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes: 'No lockfile at all -- applicability is genuinely UNKNOWN despite a confirmed match.',
  },
];
