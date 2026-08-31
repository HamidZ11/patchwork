import type { BenchmarkCase } from '../../types.js';
import { STRIPE_IMPORT, packageJsonWithStripe, packageLockWithStripe } from '../fixture-helpers.js';

const RULE_ID = 'basil-2025-03-31-adds-new-parent-field-to-invoicing-objects';

/**
 * Realistic-shape validation for Rule B (Invoice.subscription removal),
 * prioritized per the task: this is the predicate most dependent on the
 * awaited-property analysis path that exposed the Promise<T> gap in
 * slice 4, and the destructuring gap found while researching slice 5.
 * Ground truth is derived from the change semantics and source code
 * independently -- never inferred from running the analyser.
 */
export const REALISTIC_INVOICE_SUBSCRIPTION_CASES: BenchmarkCase[] = [
  // --- AFFECTED (realistic shape) ------------------------------------------
  {
    id: 'realistic-invoice-subscription-nested-service',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/invoiceService.ts': [
        STRIPE_IMPORT,
        'const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);',
        '',
        'export async function getLegacySubscriptionId(invoiceId: string): Promise<string | null> {',
        '  const invoice = await stripe.invoices.retrieve(invoiceId);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
    },
    expected: {
      status: 'AFFECTED',
      findingCount: 1,
      findingLocations: [{ sourceFile: 'src/services/invoiceService.ts', line: 6 }],
    },
    notes:
      'Rule: Invoice.subscription removal. Affected: a real async service module, in a nested ' +
      'src/services/ directory, reads invoice.subscription after an awaited retrieve() call -- ' +
      're-validates the Promise<T> fix under realistic surrounding code (return type annotation, ' +
      'an exported async function), not just a bare top-level call.',
  },
  {
    id: 'realistic-invoice-subscription-cross-file-client-singleton',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/clients/stripeClient.ts': [
        STRIPE_IMPORT,
        'export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);',
      ].join('\n'),
      'src/services/invoiceService.ts': [
        "import { stripe } from '../clients/stripeClient';",
        '',
        'export async function getSubscriptionId(invoiceId: string) {',
        '  const invoice = await stripe.invoices.retrieve(invoiceId);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes:
      'Rule: Invoice.subscription removal. Uncertain: a very common real pattern -- a shared ' +
      'Stripe client singleton exported from its own module and imported elsewhere. Each ' +
      "candidate file's analysis Program is bounded to just that file plus the trusted stub, so " +
      "the imported `stripe` binding's real type can't be resolved from invoiceService.ts alone " +
      '-- correctly UNCERTAIN, not a false match or a false negative. A distinct, more common ' +
      'variant of the already-documented cross-file limitation, worth its own case since a ' +
      'shared client module is normal production structure, not an edge case.',
  },
  {
    id: 'realistic-invoice-subscription-destructured',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/invoiceService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        'export async function getSubscriptionId(invoiceId: string) {',
        '  const { subscription } = await stripe.invoices.retrieve(invoiceId);',
        '  return subscription;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes:
      'Rule: Invoice.subscription removal. Affected: destructuring the awaited Invoice is an ' +
      'ordinary, extremely common real-world pattern -- exactly as much a usage of ' +
      'Invoice.subscription as a direct property read. This case is the concrete, empirically-' +
      "confirmed gap this slice's member-access.ts fix addresses (previously silent NOT_AFFECTED).",
  },
  {
    id: 'realistic-invoice-subscription-destructured-renamed',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/invoiceService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        'export async function getLegacySubscriptionId(invoiceId: string) {',
        '  const { subscription: legacySubscriptionId } = await stripe.invoices.retrieve(invoiceId);',
        '  return legacySubscriptionId;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes:
      'Rule: Invoice.subscription removal. Affected: destructuring with a rename is just as much ' +
      'a real usage as the shorthand form -- must resolve against the source property name, not ' +
      'the local rename target.',
  },
  {
    id: 'realistic-invoice-subscription-partial-migration',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/invoiceService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        '// TODO(migration): most call sites already use the new parent field;',
        '// this one legacy helper has not been migrated yet.',
        'export async function getLegacySubscriptionId(invoiceId: string) {',
        '  const invoice = await stripe.invoices.retrieve(invoiceId);',
        '  return invoice.subscription;',
        '}',
        '',
        'export async function getCurrentSubscriptionId(invoiceId: string) {',
        '  const invoice = await stripe.invoices.retrieve(invoiceId);',
        '  return (invoice as unknown as { parent?: { subscription_details?: { subscription?: string } } })',
        '    .parent?.subscription_details?.subscription;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes:
      'Rule: Invoice.subscription removal. Affected: a repository partway through migration -- ' +
      'one function already uses the new parent field, a sibling function still uses the removed ' +
      'field. The old usage alone is enough to warrant AFFECTED and review, regardless of whether ' +
      'other code in the same file has already migrated.',
  },
  {
    id: 'realistic-invoice-subscription-mixed-workspace-version-evidence',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'packages/billing-api/package.json': packageJsonWithStripe('^18.0.0'),
      'packages/billing-api/package-lock.json': packageLockWithStripe('18.2.0'),
      'packages/billing-api/src/services/invoiceService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: '2025-06-30.basil' });",
        '',
        'export async function getSubscriptionId(invoiceId: string) {',
        '  const invoice = await stripe.invoices.retrieve(invoiceId);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
      'packages/reporting-worker/package.json': packageJsonWithStripe('^18.0.0'),
      'packages/reporting-worker/package-lock.json': packageLockWithStripe('18.2.0'),
      'packages/reporting-worker/src/report.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: process.env.STRIPE_API_VERSION as string });",
        'export async function reportInvoice(id: string) {',
        '  return stripe.invoices.retrieve(id);',
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes:
      'Rule: Invoice.subscription removal. Affected: a realistic monorepo where one workspace ' +
      'pins an explicit apiVersion literal on/after the Basil boundary (APPLICABLE + a confirmed ' +
      'match -> AFFECTED for that workspace), and a sibling workspace reads apiVersion from an ' +
      'environment variable (DYNAMIC_UNKNOWN, no other evidence -> UNCERTAIN for that workspace). ' +
      'AFFECTED-in-one-workspace precedence means the aggregate is AFFECTED -- exercising real ' +
      'evidence-kind diversity, not just "workspace present vs. absent."',
  },

  // --- UNCERTAIN (realistic shape, documented limitations) -----------------
  {
    id: 'realistic-invoice-subscription-cross-file-layering',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/invoiceService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'export async function fetchInvoice(id: string) {',
        '  return stripe.invoices.retrieve(id);',
        '}',
      ].join('\n'),
      'src/controllers/billingController.ts': [
        "import { fetchInvoice } from '../services/invoiceService';",
        '',
        'export async function getSubscriptionId(id: string) {',
        '  const invoice = await fetchInvoice(id);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes:
      "Rule: Invoice.subscription removal. Uncertain: fetchInvoice's return type lives in a " +
      'different file from where .subscription is read -- realistic service/controller ' +
      'layering, but cross-file return-type resolution is a documented, accepted limitation ' +
      '(same-file resolution only). Must abstain safely, not guess NOT_AFFECTED.',
  },
  {
    id: 'realistic-invoice-subscription-namespace-type-annotation',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/invoiceService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        '// A common real stripe-node pattern: an explicit Stripe.Invoice type',
        '// annotation on a helper parameter.',
        'function extractSubscriptionId(invoice: Stripe.Invoice): string | null {',
        '  return invoice.subscription;',
        '}',
        '',
        'export async function getSubscriptionId(id: string) {',
        '  const invoice = await stripe.invoices.retrieve(id);',
        '  return extractSubscriptionId(invoice);',
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes:
      'Rule: Invoice.subscription removal. Uncertain (documented, deliberately not fixed this ' +
      "slice): the trusted stub declares only a default-exported class, not stripe-node's real " +
      'merged Stripe namespace, so an explicit `Stripe.Invoice` type annotation cannot resolve. ' +
      "The parameter type becomes unresolvable, so extractSubscriptionId's own property read is " +
      'correctly UNCERTAIN rather than a false match or a false negative -- a real stub-coverage ' +
      'gap, not a predicate-logic bug (see docs/impact-analysis.md).',
  },

  // --- NOT_AFFECTED (realistic shape) ---------------------------------------
  {
    id: 'realistic-invoice-subscription-unrelated-domain-model',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/clients/stripeClient.ts': [
        STRIPE_IMPORT,
        "export const stripe = new Stripe('sk_test');",
      ].join('\n'),
      'src/services/invoiceService.ts': [
        "import { stripe } from '../clients/stripeClient';",
        '',
        'export async function getInvoiceTotal(invoiceId: string) {',
        '  const invoice = await stripe.invoices.retrieve(invoiceId);',
        '  return invoice;',
        '}',
      ].join('\n'),
      'src/models/internalSubscription.ts': [
        '// An internal domain model, unrelated to Stripe, that happens to',
        '// share a property name with the removed Invoice.subscription field.',
        'export interface InternalSubscription {',
        '  subscription: string;',
        '  renewsAt: Date;',
        '}',
        '',
        'export function describeSubscription(record: InternalSubscription): string {',
        '  return `renews via ${record.subscription}`;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes:
      'Rule: Invoice.subscription removal. Not affected: real Stripe usage exists elsewhere in ' +
      'the project, but the .subscription access in this file belongs to an unrelated, locally-' +
      'defined domain interface, not the Stripe Invoice type -- must be rejected by real provenance, ' +
      'not a lexical match on the property name.',
  },
  {
    id: 'realistic-invoice-subscription-feature-genuinely-unused',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/clients/stripeClient.ts': [
        STRIPE_IMPORT,
        "export const stripe = new Stripe('sk_test');",
      ].join('\n'),
      'src/services/invoiceService.ts': [
        "import { stripe } from '../clients/stripeClient';",
        '',
        '// subscription-related fields are intentionally not read here --',
        '// this service only reports on one-off (non-subscription) invoices.',
        'export async function getOneOffInvoiceStatus(invoiceId: string) {',
        '  const invoice = await stripe.invoices.retrieve(invoiceId);',
        '  return invoice;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes:
      'Rule: Invoice.subscription removal. Not affected: Stripe is present, applicable, and the ' +
      'Invoice object is fetched and used, but .subscription is genuinely never read anywhere in ' +
      'the project.',
  },
];
