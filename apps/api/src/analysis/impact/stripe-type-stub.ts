/**
 * A small, Patchwork-owned, trusted ambient type declaration for the
 * `stripe` npm package -- NOT downloaded, NOT customer-supplied, reviewed
 * like any other rule code and committed to this repository. Repository
 * analysis deliberately never runs `npm install`/`pnpm install` (untrusted
 * code execution), so real `stripe-node` type declarations are never
 * available; this stub exists purely so the TypeScript Compiler API can
 * resolve real *provenance* (does this property access actually originate
 * from the `stripe` module?) instead of falling back to a text/regex
 * match. It declares only the exact surface this rule's predicate needs
 * -- `Stripe.invoices.retrieveUpcoming` -- verified against the real
 * `stripe-node` source (`src/resources/Invoices.ts` at tag v17.7.0, the
 * last version before it was removed) and its real export shape
 * (`export default class Stripe` in `src/stripe.esm.node.ts`), not
 * invented.
 */

export const STRIPE_TYPE_STUB_PATH = '/patchwork/stripe-type-stub.d.ts';

export const STRIPE_TYPE_STUB_CONTENT = `
declare module 'stripe' {
  interface StripeInvoicesResource {
    retrieveUpcoming(...args: unknown[]): unknown;
  }

  export default class Stripe {
    invoices: StripeInvoicesResource;
    constructor(apiKey: string, config?: { apiVersion?: string });
  }
}
`;
