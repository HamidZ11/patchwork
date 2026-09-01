/**
 * A small, Patchwork-owned, trusted ambient type declaration for the
 * `stripe` npm package -- NOT downloaded, NOT customer-supplied, reviewed
 * like any other rule code and committed to this repository. Repository
 * analysis deliberately never runs `npm install`/`pnpm install` (untrusted
 * code execution), so real `stripe-node` type declarations are never
 * available; this stub exists purely so the TypeScript Compiler API can
 * resolve real *provenance* (does this property access/call actually
 * originate from the `stripe` module?) instead of falling back to a
 * text/regex match. It declares only the exact surface each rule's
 * predicate needs, verified against the real `stripe-node` source at
 * specific tags (see each rule's own doc comment for exact provenance),
 * not invented -- and its real export shape (`export default class
 * Stripe` in `src/stripe.esm.node.ts`).
 */

export const STRIPE_TYPE_STUB_PATH = '/patchwork/stripe-type-stub.d.ts';

export const STRIPE_TYPE_STUB_CONTENT = `
// This program is built with noLib (no TypeScript lib .d.ts files are
// read -- only real Stripe provenance needs to be resolved, never global
// Array/Promise/etc. behavior). Real stripe-node methods are async, so
// callers commonly write \`await stripe.x.retrieve(...)\`; without some
// declaration of Promise, that return type is unresolvable and the
// await'd value's members can never be proven to originate from the
// stub, forcing every such call into UNCERTAIN. This minimal structural
// stand-in (not the real lib.es2015.promise.d.ts) is enough for the
// checker's await-unwrapping to work, since it only requires a callable
// \`then\` member -- it is a global ambient declaration, not customer or
// downloaded code.
interface Promise<T> {
  then<TResult = T>(onfulfilled: (value: T) => TResult): Promise<TResult>;
}

declare module 'stripe' {
  // -- Invoices -------------------------------------------------------
  // Verified against stripe-node types/Invoices.d.ts: retrieveUpcoming
  // present at tag v17.7.0, absent at v18.0.0 (replaced by createPreview).
  // Invoice.subscription present at v17.7.0, absent at v18.0.0 (replaced
  // by invoice.parent.subscription_details.subscription).
  // Verified against stripe-node types/Invoices.d.ts at tag v18.0.0:
  // \`parent: Invoice.Parent | null\`, \`Parent.subscription_details:
  // Parent.SubscriptionDetails | null\`, \`SubscriptionDetails.subscription:
  // string | Stripe.Subscription\` (not itself nullable -- only reachable
  // once subscription_details is non-null). Used only to independently
  // prove the *replacement* pattern's Stripe provenance after a Rule B
  // remediation rewrite (see remediation/recipes/) -- distinct interface
  // from StripeInvoice so the two \`.subscription\` properties resolve to
  // different declarations and are never conflated by a postcondition
  // check.
  interface StripeInvoiceSubscriptionDetails {
    subscription: string;
  }

  interface StripeInvoiceParent {
    subscription_details: StripeInvoiceSubscriptionDetails | null;
  }

  interface StripeInvoice {
    subscription: string | null;
    parent: StripeInvoiceParent | null;
  }

  interface StripeInvoicesResource {
    retrieveUpcoming(...args: unknown[]): unknown;
    retrieve(...args: unknown[]): Promise<StripeInvoice>;
  }

  // -- Subscription schedules ------------------------------------------
  // Verified against stripe-node types/SubscriptionSchedulesResource.d.ts:
  // Phase.iterations present through v18.5.0, absent at v19.0.0/v19.1.0
  // (replaced by duration).
  interface StripeSubscriptionSchedulePhase {
    iterations?: number;
    [key: string]: unknown;
  }

  interface StripeSubscriptionScheduleCreateParams {
    phases: StripeSubscriptionSchedulePhase[];
    [key: string]: unknown;
  }

  interface StripeSubscriptionSchedulesResource {
    create(params: StripeSubscriptionScheduleCreateParams, ...rest: unknown[]): unknown;
    update(id: string, params: StripeSubscriptionScheduleCreateParams, ...rest: unknown[]): unknown;
  }

  // -- Issuing -----------------------------------------------------------
  // Verified against stripe-node types/Issuing/Authorizations.d.ts:
  // Status union is 'closed' | 'pending' | 'reversed' at v17.7.0, gains
  // 'expired' at v18.0.0.
  type StripeIssuingAuthorizationStatus = 'closed' | 'pending' | 'reversed';

  interface StripeIssuingAuthorization {
    status: StripeIssuingAuthorizationStatus;
  }

  interface StripeIssuingAuthorizationsResource {
    retrieve(...args: unknown[]): Promise<StripeIssuingAuthorization>;
  }

  interface StripeIssuingResource {
    authorizations: StripeIssuingAuthorizationsResource;
  }

  export default class Stripe {
    invoices: StripeInvoicesResource;
    subscriptionSchedules: StripeSubscriptionSchedulesResource;
    issuing: StripeIssuingResource;
    constructor(apiKey: string, config?: { apiVersion?: string });
  }
}
`;
