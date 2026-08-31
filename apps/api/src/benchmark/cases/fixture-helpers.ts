export const STRIPE_IMPORT = "import Stripe from 'stripe';";

export function packageJsonWithStripe(range: string): string {
  return JSON.stringify({ dependencies: { stripe: range } });
}

export function packageLockWithStripe(version: string): string {
  return JSON.stringify({ packages: { '': {}, 'node_modules/stripe': { version } } });
}
