import type { BenchmarkCase } from '../types.js';
import { STRIPE_IMPORT, packageJsonWithStripe, packageLockWithStripe } from './fixture-helpers.js';

const RULE_ID = 'clover-2025-09-30-remove-iterations';

export const SCHEDULE_ITERATIONS_CASES: BenchmarkCase[] = [
  // --- POSITIVE -----------------------------------------------------------
  {
    id: 'schedule-iterations-positive-direct-create',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^19.0.0'),
      'package-lock.json': packageLockWithStripe('19.1.0'),
      'src/schedules.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'stripe.subscriptionSchedules.create({ phases: [{ iterations: 3 }] });',
      ].join('\n'),
    },
    expected: {
      status: 'AFFECTED',
      findingCount: 1,
      findingLocations: [{ sourceFile: 'src/schedules.ts', line: 3 }],
    },
    notes: 'Direct create() call with the removed iterations parameter, on an applicable SDK.',
  },
  {
    id: 'schedule-iterations-positive-local-alias',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^19.0.0'),
      'package-lock.json': packageLockWithStripe('19.1.0'),
      'src/schedules.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'const schedules = stripe.subscriptionSchedules;',
        'schedules.create({ phases: [{ iterations: 3 }] });',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes: 'A same-file local alias of subscriptionSchedules should still resolve.',
  },
  {
    id: 'schedule-iterations-positive-multiple-usages',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^19.0.0'),
      'package-lock.json': packageLockWithStripe('19.1.0'),
      'src/schedules.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'stripe.subscriptionSchedules.create({ phases: [{ iterations: 3 }] });',
        "stripe.subscriptionSchedules.update('sub_sched_1', { phases: [{ iterations: 1 }] });",
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 2 },
    notes: 'Both create() and update() are affected surfaces; each must produce its own finding.',
  },
  {
    id: 'schedule-iterations-positive-nested-workspace',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'packages/billing/package.json': packageJsonWithStripe('^19.0.0'),
      'packages/billing/package-lock.json': packageLockWithStripe('19.1.0'),
      'packages/billing/src/schedules.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'stripe.subscriptionSchedules.create({ phases: [{ iterations: 3 }] });',
      ].join('\n'),
      'packages/web/package.json': JSON.stringify({ dependencies: {} }),
      'packages/web/src/index.ts': 'export const x = 1;',
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes: 'A monorepo workspace with the affected usage should still resolve to AFFECTED.',
  },

  // --- NEGATIVE -------------------------------------------------------------
  {
    id: 'schedule-iterations-negative-unrelated-object',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^19.0.0'),
      'package-lock.json': packageLockWithStripe('19.1.0'),
      'src/other.ts': [
        'const scheduler = { create: (p: unknown) => p };',
        'scheduler.create({ phases: [{ iterations: 3 }] });',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'Same method name and argument property on an unrelated object must be rejected.',
  },
  {
    id: 'schedule-iterations-negative-comment-only',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^19.0.0'),
      'package-lock.json': packageLockWithStripe('19.1.0'),
      'src/notes.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '// TODO: we used to pass iterations here, migrated to duration already',
        'const note = "iterations is deprecated";',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'The identifier appearing only in a comment/string is not a usage.',
  },
  {
    id: 'schedule-iterations-negative-feature-unused',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^19.0.0'),
      'package-lock.json': packageLockWithStripe('19.1.0'),
      'src/schedules.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '// iterations was removed in favor of duration',
        "stripe.subscriptionSchedules.create({ phases: [{ duration: 'month' }] });",
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'Stripe is present and applicable, but the repository already uses duration instead.',
  },
  {
    id: 'schedule-iterations-negative-pre-boundary-api-version',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.5.0'),
      'package-lock.json': packageLockWithStripe('18.5.0'),
      'src/schedules.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: '2025-06-30.basil' });",
        'stripe.subscriptionSchedules.create({ phases: [{ iterations: 3 }] });',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes:
      'A different, later boundary than the Basil rules (v19 / 2025-09-30) -- proves ' +
      'ApplicabilityConfig genuinely generalizes to a second date/version, not just the first.',
  },

  // --- UNCERTAIN --------------------------------------------------------------
  {
    id: 'schedule-iterations-uncertain-dynamic-construction',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^19.0.0'),
      'package-lock.json': packageLockWithStripe('19.1.0'),
      'src/dynamic.ts': [
        'function getCtor(): any { return null; }',
        'const StripeCtor = getCtor();',
        "const stripe = new StripeCtor('sk_test');",
        'stripe.subscriptionSchedules.create({ phases: [{ iterations: 3 }] });',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes: 'Dynamic client construction cannot be proven to originate from the stub either way.',
  },
  {
    id: 'schedule-iterations-uncertain-unresolved-import',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^19.0.0'),
      'package-lock.json': packageLockWithStripe('19.1.0'),
      'src/wrapper.ts': [
        "import { schedules } from './schedule-client';",
        'schedules.create({ phases: [{ iterations: 3 }] });',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes: "The import target ('./schedule-client') was never extracted -- unresolvable.",
  },
  {
    id: 'schedule-iterations-uncertain-unknown-version',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^19.0.0'),
      'src/schedules.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'stripe.subscriptionSchedules.create({ phases: [{ iterations: 3 }] });',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes: 'No lockfile at all -- applicability is genuinely UNKNOWN despite a confirmed match.',
  },
];
