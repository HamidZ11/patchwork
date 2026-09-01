import { STRIPE_INVOICE_SUBSCRIPTION_TO_PARENT_RECIPE } from './recipes/invoice-subscription-to-parent.js';
import type { RemediationRecipe } from './types.js';

/**
 * Every currently-known remediation recipe -- one hardcoded, reviewed
 * entry per proven-safe mechanical transformation, mirroring
 * analysis/impact/registry.ts's IMPACT_RULES. Deliberately just one entry
 * today: Rule A (retrieveUpcoming -> createPreview) was evaluated and
 * rejected -- no argument shape of that call maps 1:1 to createPreview
 * (Stripe's own changelog: previewing "across all subscriptions" via a
 * bare `{ customer }` call is removed outright, not relocated). Rules C
 * and D were also evaluated and rejected (iterations->duration needs
 * external billing-interval context not present at the call site;
 * issuing-authorization-status is a response enum addition with no
 * mechanical fix, only a business-logic decision). See this recipe's own
 * doc comment for the verified safe/refused shape analysis.
 */
export const REMEDIATION_RECIPES: RemediationRecipe[] = [
  STRIPE_INVOICE_SUBSCRIPTION_TO_PARENT_RECIPE,
];

export function findRecipeForPredicateKind(predicateKind: string): RemediationRecipe | undefined {
  return REMEDIATION_RECIPES.find((recipe) => recipe.predicateKind === predicateKind);
}
