import { scanForLiteralComparison } from '../predicates/literal-comparison.js';
import type { RuleDefinition } from '../types.js';

/**
 * Every field below is verified against Stripe's own official sources:
 *
 * - Changelog (source of truth):
 *   https://docs.stripe.com/changelog/basil/2025-03-31/issuing-authorizations-expired
 *   -- verbatim: "Issuing authorizations expired by Stripe now transition
 *   to the `expired` status instead of the `reversed` status... This
 *   change introduces a new enum value, `expired`, on the status field of
 *   Issuing authorization objects."
 * - SDK boundary, verified directly against stripe-node source:
 *   `types/Issuing/Authorizations.d.ts`'s `Status` union is `'closed' |
 *   'pending' | 'reversed'` at tag v17.7.0; becomes `'closed' | 'expired'
 *   | 'pending' | 'reversed'` at v18.0.0.
 *
 * Unlike Rules A/B/C, this isn't a removed member -- the code still
 * compiles. The predicate targets the resulting semantic gap: source that
 * special-cases `status === 'reversed'` now silently misses the
 * newly-split-out `'expired'` case it used to cover.
 */
export const STRIPE_BASIL_ISSUING_AUTHORIZATION_STATUS_RULE: RuleDefinition = {
  providerChange: {
    provider: 'stripe',
    externalId: 'basil-2025-03-31-issuing-authorizations-expired',
    title:
      "Adds 'expired' as a distinct Issuing Authorization status, previously reported as 'reversed'",
    sourceUrl: 'https://docs.stripe.com/changelog/basil/2025-03-31/issuing-authorizations-expired',
    ruleVersion: 'v1',
    predicateKind: 'stripe_issuing_authorization_status_reversed',
    migrationRequirement:
      "Issuing authorizations expired by Stripe now transition to the expired status instead of the reversed status. This change introduces a new enum value, expired, on the status field of Issuing authorization objects. Update any logic that specifically checks for status === 'reversed' to also handle 'expired'.",
  },
  applicabilityConfig: {
    sdkBoundaryMajor: 18,
    apiVersionBoundaryDate: '2025-03-31',
    changeDescription: "the 'expired' status value was introduced",
  },
  runPredicate: (files) =>
    scanForLiteralComparison(files, {
      propertyName: 'status',
      literalValue: 'reversed',
      matchedSymbol: "authorization.status === 'reversed'",
    }),
};
