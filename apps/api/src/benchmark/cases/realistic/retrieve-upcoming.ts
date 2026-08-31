import type { BenchmarkCase } from '../../types.js';
import { STRIPE_IMPORT, packageJsonWithStripe, packageLockWithStripe } from '../fixture-helpers.js';

const RULE_ID = 'basil-2025-03-31-invoice-preview-api-deprecations';

/**
 * Realistic-shape validation for Rule A (retrieveUpcoming removal). A
 * smaller set than rules B/D per the task's stated priority -- slice 4's
 * control corpus already covers this rule reasonably (it was the first
 * rule implemented and hand-shaped around it). These cases exercise new
 * realistic shapes the control corpus never tried: a class-based service
 * (all control fixtures are plain functions) and mixed-version-evidence
 * workspaces.
 */
export const REALISTIC_RETRIEVE_UPCOMING_CASES: BenchmarkCase[] = [
  {
    id: 'realistic-retrieve-upcoming-class-based-service',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/InvoiceService.ts': [
        STRIPE_IMPORT,
        '',
        'export class InvoiceService {',
        "  private readonly stripe = new Stripe('sk_test');",
        '',
        '  previewCustomerInvoice(customerId: string) {',
        '    return this.stripe.invoices.retrieveUpcoming({ customer: customerId });',
        '  }',
        '}',
      ].join('\n'),
    },
    expected: {
      status: 'AFFECTED',
      findingCount: 1,
      findingLocations: [{ sourceFile: 'src/services/InvoiceService.ts', line: 7 }],
    },
    notes:
      'Rule: retrieveUpcoming removal. Affected: a class-based service (a NestJS/Express-shaped ' +
      "class with a private field and a method), never exercised in slice 4's all-plain-function " +
      'control corpus -- ordinary type inference should resolve `this.stripe` the same way it ' +
      'resolves a plain local const.',
  },
  {
    id: 'realistic-retrieve-upcoming-mixed-workspace-version-evidence',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'packages/billing-api/package.json': packageJsonWithStripe('^18.0.0'),
      'packages/billing-api/package-lock.json': packageLockWithStripe('18.2.0'),
      'packages/billing-api/src/services/invoiceService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: '2025-06-30.basil' });",
        'export function previewInvoice(customerId: string) {',
        '  return stripe.invoices.retrieveUpcoming({ customer: customerId });',
        '}',
      ].join('\n'),
      'packages/reporting-worker/package.json': packageJsonWithStripe('^18.0.0'),
      'packages/reporting-worker/package-lock.json': packageLockWithStripe('18.2.0'),
      'packages/reporting-worker/src/report.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: process.env.STRIPE_API_VERSION as string });",
        'export function loadInvoices() {',
        '  return stripe.invoices;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes:
      'Rule: retrieveUpcoming removal. Affected: a realistic monorepo with mixed version-evidence ' +
      'kinds across workspaces (explicit literal vs. dynamic env var) -- AFFECTED-in-one-workspace ' +
      'precedence means the aggregate is AFFECTED.',
  },
  {
    id: 'realistic-retrieve-upcoming-feature-genuinely-unused-in-larger-project',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/InvoiceService.ts': [
        STRIPE_IMPORT,
        '',
        'export class InvoiceService {',
        "  private readonly stripe = new Stripe('sk_test');",
        '',
        '  previewCustomerInvoice(customerId: string) {',
        '    // retrieveUpcoming was removed in Basil; this service already',
        '    // migrated to createPreview.',
        '    return this.stripe.invoices.createPreview({ customer: customerId });',
        '  }',
        '}',
      ].join('\n'),
      'src/controllers/billingController.ts': [
        "import { InvoiceService } from '../services/InvoiceService';",
        '',
        'export class BillingController {',
        '  constructor(private readonly invoiceService: InvoiceService) {}',
        '',
        '  handlePreview(customerId: string) {',
        '    return this.invoiceService.previewCustomerInvoice(customerId);',
        '  }',
        '}',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes:
      'Rule: retrieveUpcoming removal. Not affected: a realistic multi-file, class-based service/' +
      'controller project that has already fully migrated to createPreview -- must remain ' +
      'NOT_AFFECTED across a larger surface, not just a two-line fixture.',
  },
];
