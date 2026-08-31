import { scanForMemberAccess } from '../predicates/member-access.js';
import type { RuleDefinition } from '../types.js';

/**
 * Every field below is verified against Stripe's own official sources:
 *
 * - Changelog (source of truth):
 *   https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects
 *   -- verbatim: "we deprecated the `quote`, `subscription`,
 *   `subscription_details`, and `subscription_proration_date` fields...
 *   Use `invoice.parent.subscription_details.subscription` (verify
 *   `invoice.parent.type` is `subscription_details`) instead of
 *   `invoice.subscription`."
 * - SDK boundary, verified directly against stripe-node source:
 *   `Invoice.subscription` exists in `types/Invoices.d.ts` at tag
 *   v17.7.0 (pre-Basil); absent at v18.0.0, replaced by
 *   `Invoice.parent.subscription_details.subscription`.
 */
export const STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE: RuleDefinition = {
  providerChange: {
    provider: 'stripe',
    externalId: 'basil-2025-03-31-adds-new-parent-field-to-invoicing-objects',
    title:
      'Removes Invoice.subscription in favor of Invoice.parent.subscription_details.subscription',
    sourceUrl:
      'https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects',
    ruleVersion: 'v1',
    predicateKind: 'stripe_invoice_subscription_property',
    migrationRequirement:
      'We deprecated the quote, subscription, subscription_details, and subscription_proration_date fields on the Invoice object. Use invoice.parent.subscription_details.subscription (verify invoice.parent.type is subscription_details) instead of invoice.subscription.',
  },
  applicabilityConfig: {
    sdkBoundaryMajor: 18,
    apiVersionBoundaryDate: '2025-03-31',
    changeDescription: 'Invoice.subscription was removed from the SDK',
  },
  runPredicate: (files) =>
    scanForMemberAccess(files, {
      propertyName: 'subscription',
      matchedSymbol: 'invoice.subscription',
    }),
};
