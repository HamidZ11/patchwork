import type { BenchmarkCase } from '../../types.js';

const RULE_ID = 'clover-2025-09-30-remove-iterations';

/**
 * Historical validation for Rule C (iterations parameter removal).
 *
 * Source: github.com/Avanti-Creativo/bill-korman-website (public), file
 * src/app/api/stripe/installment-plan/route.ts. Before SHA
 * 931f668540babc089cbe39de52916c7e3bdd9656. Migration commit
 * 71ecd30172112206f7f07e5a4a82bdd018e0e76e ("fix(stripe): installment
 * schedule uses duration (API 2025-08-27+), not iterations") changed
 * exactly:
 *   - phases: [{ items: [...], iterations: 3 }] as any
 *   + phases: [{ items: [...], duration: { interval: 'month', interval_count: 3 } }]
 * Verified directly against the real commit's patch and the before-SHA's
 * package-lock.json (stripe resolves EXACT to 22.3.0) via the GitHub API.
 *
 * Minimal reconstruction of the relevant handler only -- trimmed of
 * unrelated payment_intent/3-DS handling not touched by this migration.
 *
 * The Stripe client is imported cross-file (`import { stripe } from
 * '@/lib/stripe'`) in the real code -- the already-documented cross-file
 * client-singleton limitation. Empirically verified before this fixture
 * was written: the real predicate reports 1 ambiguous reference, 0
 * matches, for this exact reconstruction -- UNCERTAIN, not a bug. Note
 * the `iterations` property *is* still found structurally despite the
 * real code's `as any` cast on the phases array (the shallow AST search
 * isn't defeated by a type-level cast); the ambiguity is entirely from
 * the unresolved callee, not the argument search.
 */
export const HISTORICAL_SCHEDULE_ITERATIONS_CASES: BenchmarkCase[] = [
  {
    id: 'historical-schedule-iterations-bill-korman',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'historical',
    historical: {
      repository: 'Avanti-Creativo/bill-korman-website',
      beforeSha: '931f668540babc089cbe39de52916c7e3bdd9656',
      afterSha: '71ecd30172112206f7f07e5a4a82bdd018e0e76e',
      sourceCommitUrl:
        'https://github.com/Avanti-Creativo/bill-korman-website/commit/71ecd30172112206f7f07e5a4a82bdd018e0e76e',
      actualChangedLocations: [{ sourceFile: 'route.ts', line: 7 }],
      rationale:
        "The developer's real migration commit replaced the iterations: 3 phase parameter " +
        "with a duration object because Stripe's API 2025-08-27+ removed iterations from " +
        'subscription schedule phases.',
    },
    files: {
      'package.json': JSON.stringify({ dependencies: { stripe: '^22.3.0' } }),
      'package-lock.json': JSON.stringify({
        packages: { '': {}, 'node_modules/stripe': { version: '22.3.0' } },
      }),
      'route.ts': [
        "import { stripe, resolveCustomerPaymentMethod } from '@/lib/stripe';",
        'export async function POST() {',
        '  const schedule = await stripe.subscriptionSchedules.create({',
        "    customer: 'cus_1',",
        "    start_date: 'now',",
        "    end_behavior: 'cancel',",
        "    phases: [{ items: [{ price: 'price_1', quantity: 1 }], iterations: 3 }] as any,",
        '  });',
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes:
      'Historical correct abstention, not a safety failure: real production code imports ' +
      'its Stripe client from a shared module (`@/lib/stripe`), the standard idiomatic ' +
      'pattern for real applications. Each candidate file is analysed in a bounded Program ' +
      "containing only that file plus the trusted stub, so the imported client's real type " +
      "can't be resolved from this file alone -- the analyser correctly abstains rather than " +
      'guessing NOT_AFFECTED, even though the iterations property itself is found (proving ' +
      "the real code's `as any` cast on the argument doesn't silently defeat detection). " +
      'Empirically verified against the real predicate before this fixture was written.',
  },
];
