import type { BenchmarkCase } from '../../types.js';

const RULE_ID = 'basil-2025-03-31-invoice-preview-api-deprecations';

/**
 * Historical validation for Rule A (retrieveUpcoming removal).
 *
 * Source: github.com/dzinesco/route-commerce (public), file
 * src/lib/stripe-billing.ts. Before SHA fbddd2458ea72c12258403e621dd8baf4128ebb1
 * (the exact commit prior to the developer's migration). Migration commit
 * dad8b0fbe37ffedbfdb6aa297400e41317f1b8bb ("fix: resolve all TypeScript
 * errors in stripe-billing.ts") changed exactly:
 *   - stripe.invoices.retrieveUpcoming({ customer: customerId })
 *   + stripe.invoices.createPreview({ customer: customerId })
 * inside getUpcomingInvoice(). Verified directly against the real commit's
 * patch and the before-SHA's package.json (no lockfile in this repo;
 * "stripe": "^22.1.1" declared) via the GitHub API, not paraphrased.
 *
 * This is a minimal reconstruction of the relevant function only -- the
 * real file also has unrelated checkout/webhook/usage-record code not
 * touched by this migration, deliberately not vendored here (see
 * docs/impact-analysis.md's Historical validation section).
 */
export const HISTORICAL_RETRIEVE_UPCOMING_CASES: BenchmarkCase[] = [
  {
    id: 'historical-retrieve-upcoming-route-commerce',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'historical',
    historical: {
      repository: 'dzinesco/route-commerce',
      beforeSha: 'fbddd2458ea72c12258403e621dd8baf4128ebb1',
      afterSha: 'dad8b0fbe37ffedbfdb6aa297400e41317f1b8bb',
      sourceCommitUrl:
        'https://github.com/dzinesco/route-commerce/commit/dad8b0fbe37ffedbfdb6aa297400e41317f1b8bb',
      actualChangedLocations: [{ sourceFile: 'src/lib/stripe-billing.ts', line: 4 }],
      rationale:
        "The developer's real migration commit replaced " +
        'stripe.invoices.retrieveUpcoming with stripe.invoices.createPreview at exactly this ' +
        'line, in getUpcomingInvoice(), because SDK v18+ removed the old method.',
    },
    files: {
      // No lockfile committed in the real repo -- SDK resolution is
      // DECLARED_ONLY there; applicability instead comes from the
      // explicit apiVersion literal pinned in source (real, unmodified).
      'package.json': JSON.stringify({ dependencies: { stripe: '^22.1.1' } }),
      'src/lib/stripe-billing.ts': [
        'import Stripe from "stripe";',
        'const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-04-30.basil" });',
        'export async function getUpcomingInvoice(customerId: string) {',
        '  return await stripe.invoices.retrieveUpcoming({',
        '    customer: customerId,',
        '  });',
        '}',
      ].join('\n'),
    },
    expected: {
      status: 'AFFECTED',
      findingCount: 1,
      findingLocations: [{ sourceFile: 'src/lib/stripe-billing.ts', line: 4 }],
    },
    notes:
      'Historical true positive: real production code, same-file Stripe client ' +
      'construction with an explicit on-boundary apiVersion literal, a direct, unaliased ' +
      'retrieveUpcoming call. Patchwork on the before-state should find exactly the ' +
      'location the developer later changed -- empirically verified against the real ' +
      'predicate before this fixture was written, not assumed.',
  },
];
