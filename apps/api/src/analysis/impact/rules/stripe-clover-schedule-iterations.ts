import { scanForCallArgumentProperty } from '../predicates/call-argument-property.js';
import type { RuleDefinition } from '../types.js';

/**
 * Every field below is verified against Stripe's own official sources:
 *
 * - Changelog (source of truth):
 *   https://docs.stripe.com/changelog/clover/2025-09-30/remove-iterations
 *   -- verbatim: "We've removed the `iterations` parameter because
 *   `duration` replaces its functionality... Using `iterations` in these
 *   endpoints now returns an error."
 * - SDK boundary, verified directly against stripe-node source:
 *   `iterations?: number` exists on the subscription-schedule Phase params
 *   in `types/SubscriptionSchedulesResource.d.ts` through tag v18.5.0;
 *   absent at v19.0.0/v19.1.0.
 *
 * Different API-version boundary than the Basil rules
 * (2025-09-30.clover / SDK v19, not 2025-03-31.basil / SDK v18) --
 * deliberately, to prove the applicability primitive generalizes to a
 * second boundary, not just reproduces the first one.
 */
export const STRIPE_CLOVER_SCHEDULE_ITERATIONS_RULE: RuleDefinition = {
  providerChange: {
    provider: 'stripe',
    externalId: 'clover-2025-09-30-remove-iterations',
    title: 'Removes the iterations parameter from Subscription Schedule phases',
    sourceUrl: 'https://docs.stripe.com/changelog/clover/2025-09-30/remove-iterations',
    ruleVersion: 'v1',
    predicateKind: 'stripe_subscription_schedule_iterations_param',
    migrationRequirement:
      "We've removed the iterations parameter because duration replaces its functionality on the subscription schedule phases. Using iterations in these endpoints now returns an error.",
  },
  applicabilityConfig: {
    sdkBoundaryMajor: 19,
    apiVersionBoundaryDate: '2025-09-30',
    changeDescription: 'the iterations parameter was removed from the SDK',
  },
  runPredicate: (files) =>
    scanForCallArgumentProperty(files, {
      methodNames: ['create', 'update'],
      argumentPropertyName: 'iterations',
      matchedSymbol: 'stripe.subscriptionSchedules.{create,update}({ phases: [{ iterations }] })',
    }),
};
