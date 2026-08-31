import { STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE } from './rules/stripe-basil-invoice-subscription.js';
import { STRIPE_BASIL_ISSUING_AUTHORIZATION_STATUS_RULE } from './rules/stripe-basil-issuing-authorization-status.js';
import { STRIPE_BASIL_RETRIEVE_UPCOMING_RULE } from './rules/stripe-basil-retrieve-upcoming.js';
import { STRIPE_CLOVER_SCHEDULE_ITERATIONS_RULE } from './rules/stripe-clover-schedule-iterations.js';
import type { RuleDefinition } from './types.js';

/**
 * Every currently-known rule -- manually encoded, one real, officially-
 * verified Stripe change each (see each rule's own doc comment for exact
 * provenance). Not an ingestion pipeline; adding a rule means adding a
 * file here and reviewing it like any other code.
 */
export const IMPACT_RULES: RuleDefinition[] = [
  STRIPE_BASIL_RETRIEVE_UPCOMING_RULE,
  STRIPE_BASIL_INVOICE_SUBSCRIPTION_RULE,
  STRIPE_CLOVER_SCHEDULE_ITERATIONS_RULE,
  STRIPE_BASIL_ISSUING_AUTHORIZATION_STATUS_RULE,
];
