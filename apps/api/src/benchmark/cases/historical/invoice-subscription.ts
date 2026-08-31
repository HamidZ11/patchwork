import type { BenchmarkCase } from '../../types.js';

const RULE_ID = 'basil-2025-03-31-adds-new-parent-field-to-invoicing-objects';

/**
 * Historical validation for Rule B (Invoice.subscription removal).
 *
 * Source: github.com/caterbidsUK/caterbids.uk (public), file
 * app/api/stripe/webhook/route.ts. Before SHA
 * 1959db44057465053f4d662cf81e4ff5ddb7cc23. Migration commit
 * c6556b5a3a1ddacc34f407a4c24e60203def95b7 ("Fix Stripe v22 Invoice type:
 * subscription moved to parent.subscription_details") changed exactly, at
 * two call sites (invoice.paid and invoice.payment_failed handlers,
 * original file lines 152 and 183):
 *   - const rawSub = invoice.subscription
 *   + const rawSub = invoice.parent?.subscription_details?.subscription ?? null
 * Verified directly against the real commit's patch and the before-SHA's
 * package-lock.json (stripe resolves EXACT to 22.1.1) via the GitHub API.
 *
 * Minimal reconstruction of the two relevant handler blocks only -- the
 * real file is 604 lines including unrelated Supabase/Sentry/email logic
 * not touched by this migration, deliberately not vendored here. Line
 * numbers below are relative to this reconstruction, not the original
 * file (see docs/impact-analysis.md's Historical validation section for
 * why, and the original lines cited above for cross-reference).
 *
 * Both call sites read `invoice` from `event.data.object as
 * Stripe.Invoice` -- the already-documented Stripe.X namespace-annotation
 * stub gap (the trusted stub declares no merged Stripe namespace, so this
 * cast is unresolvable). Empirically verified before this fixture was
 * written: the real predicate reports 2 ambiguous references, 0 matches,
 * for this exact reconstruction -- UNCERTAIN, not a bug.
 */
export const HISTORICAL_INVOICE_SUBSCRIPTION_CASES: BenchmarkCase[] = [
  {
    id: 'historical-invoice-subscription-caterbids',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'historical',
    historical: {
      repository: 'caterbidsUK/caterbids.uk',
      beforeSha: '1959db44057465053f4d662cf81e4ff5ddb7cc23',
      afterSha: 'c6556b5a3a1ddacc34f407a4c24e60203def95b7',
      sourceCommitUrl:
        'https://github.com/caterbidsUK/caterbids.uk/commit/c6556b5a3a1ddacc34f407a4c24e60203def95b7',
      actualChangedLocations: [
        { sourceFile: 'route.ts', line: 7 },
        { sourceFile: 'route.ts', line: 12 },
      ],
      rationale:
        "The developer's real migration commit replaced invoice.subscription with " +
        'invoice.parent?.subscription_details?.subscription at both the invoice.paid and ' +
        'invoice.payment_failed handlers (original file lines 152 and 183) because SDK v18+ ' +
        'removed the old field.',
    },
    files: {
      'package.json': JSON.stringify({ dependencies: { stripe: '^22.1.1' } }),
      'package-lock.json': JSON.stringify({
        packages: { '': {}, 'node_modules/stripe': { version: '22.1.1' } },
      }),
      'route.ts': [
        'import Stripe from "stripe"',
        'import { stripe } from "@/lib/stripe"',
        'export async function POST(req: Request) {',
        '  const event = stripe.webhooks.constructEvent("", "", "");',
        '  if (event.type === "invoice.paid") {',
        '    const invoice = event.data.object as Stripe.Invoice',
        '    const rawSub = invoice.subscription',
        '    const subId = typeof rawSub === "string" ? rawSub : (rawSub as Stripe.Subscription | null)?.id ?? null',
        '  }',
        '  if (event.type === "invoice.payment_failed") {',
        '    const invoice = event.data.object as Stripe.Invoice',
        '    const rawSub = invoice.subscription',
        '    const subId = typeof rawSub === "string" ? rawSub : (rawSub as Stripe.Subscription | null)?.id ?? null',
        '  }',
        '  return new Response();',
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes:
      'Historical correct abstention, not a safety failure: real production webhook code ' +
      'reads the Invoice via `event.data.object as Stripe.Invoice`, the standard idiomatic ' +
      'pattern for Stripe webhook handlers in TypeScript (every other real Rule B migration ' +
      "found during this slice's research used the identical pattern). Our trusted stub " +
      "doesn't declare a merged Stripe namespace, so this cast is unresolvable and the " +
      'analyser correctly abstains rather than guessing NOT_AFFECTED. Empirically verified ' +
      'against the real predicate before this fixture was written.',
  },
];
