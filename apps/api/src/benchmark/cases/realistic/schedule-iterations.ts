import type { BenchmarkCase } from '../../types.js';
import { STRIPE_IMPORT, packageJsonWithStripe, packageLockWithStripe } from '../fixture-helpers.js';

const RULE_ID = 'clover-2025-09-30-remove-iterations';

/**
 * Realistic-shape validation for Rule C (iterations parameter removal). A
 * smaller set than rules B/D per the task's stated priority. The
 * variable-built-phase case is the concrete, empirically-confirmed gap
 * this slice's call-argument-property.ts fix addresses.
 */
export const REALISTIC_SCHEDULE_ITERATIONS_CASES: BenchmarkCase[] = [
  {
    id: 'realistic-schedule-iterations-variable-built-phase',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^19.0.0'),
      'package-lock.json': packageLockWithStripe('19.1.0'),
      'src/services/scheduleService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        'export function createMonthlySchedule(customerId: string) {',
        "  const phase = { iterations: 3, plan: 'plan_monthly' };",
        '  return stripe.subscriptionSchedules.create({',
        '    customer: customerId,',
        '    phases: [phase],',
        '  });',
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes:
      'Rule: iterations parameter removal. Affected: a phase object built as a separate, named ' +
      'same-file variable and referenced (not written inline) is a realistic, readable way to ' +
      'build a create() call -- previously invisible to this predicate. This case is the concrete, ' +
      "empirically-confirmed gap this slice's call-argument-property.ts fix addresses (previously " +
      'silent NOT_AFFECTED).',
  },
  {
    id: 'realistic-schedule-iterations-mixed-workspace-version-evidence',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'packages/billing-api/package.json': packageJsonWithStripe('^19.0.0'),
      'packages/billing-api/package-lock.json': packageLockWithStripe('19.1.0'),
      'packages/billing-api/src/services/scheduleService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: '2025-10-15.clover' });",
        'export function createSchedule(customerId: string) {',
        '  return stripe.subscriptionSchedules.create({',
        '    customer: customerId,',
        '    phases: [{ iterations: 3 }],',
        '  });',
        '}',
      ].join('\n'),
      'packages/reporting-worker/package.json': packageJsonWithStripe('^19.0.0'),
      'packages/reporting-worker/package-lock.json': packageLockWithStripe('19.1.0'),
      'packages/reporting-worker/src/report.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: process.env.STRIPE_API_VERSION as string });",
        'export function loadSchedules() {',
        '  return stripe.subscriptionSchedules;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes:
      'Rule: iterations parameter removal. Affected: a realistic monorepo with mixed version-' +
      'evidence kinds across workspaces (explicit literal on/after the Clover boundary vs. a ' +
      'dynamic env var) -- AFFECTED-in-one-workspace precedence means the aggregate is AFFECTED.',
  },
  {
    id: 'realistic-schedule-iterations-unresolvable-phase-parameter',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^19.0.0'),
      'package-lock.json': packageLockWithStripe('19.1.0'),
      'src/services/scheduleService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        '// phase is provided by the caller and may or may not set',
        '// iterations -- comes from a public API surface, not constructed here.',
        'export function createSchedule(customerId: string, phase: unknown) {',
        '  return stripe.subscriptionSchedules.create({',
        '    customer: customerId,',
        '    phases: [phase as never],',
        '  });',
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes:
      'Rule: iterations parameter removal. Uncertain: the phase argument is a caller-supplied ' +
      'parameter whose shape cannot be resolved (an unknown/dynamic type) -- neither confirmed ' +
      'present nor confirmed absent, so the analyser must abstain rather than concluding the ' +
      "feature is genuinely unused. This directly exercises this slice's ambiguous-fallback fix " +
      '(previously such an argument was silently treated as "unused," a real safety gap).',
  },
];
