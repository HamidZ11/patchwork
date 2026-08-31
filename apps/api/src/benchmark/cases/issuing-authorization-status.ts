import type { BenchmarkCase } from '../types.js';
import { STRIPE_IMPORT, packageJsonWithStripe, packageLockWithStripe } from './fixture-helpers.js';

const RULE_ID = 'basil-2025-03-31-issuing-authorizations-expired';

export const ISSUING_AUTHORIZATION_STATUS_CASES: BenchmarkCase[] = [
  // --- POSITIVE -----------------------------------------------------------
  {
    id: 'issuing-authorization-status-positive-direct-comparison',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/issuing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function isReversed(id: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(id);',
        "  return authorization.status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: {
      status: 'AFFECTED',
      findingCount: 1,
      findingLocations: [{ sourceFile: 'src/issuing.ts', line: 5 }],
    },
    notes: 'The legacy comparison pattern that now silently misses the split-out expired status.',
  },
  {
    id: 'issuing-authorization-status-positive-local-alias',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/issuing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function isReversed(id: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(id);',
        '  const auth = authorization;',
        "  return auth.status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes: 'A same-file local alias of the resolved Authorization object should still resolve.',
  },
  {
    id: 'issuing-authorization-status-positive-multiple-usages',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/issuing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function checkBoth(id1: string, id2: string) {',
        '  const a = await stripe.issuing.authorizations.retrieve(id1);',
        '  const b = await stripe.issuing.authorizations.retrieve(id2);',
        "  return a.status === 'reversed' || b.status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 2 },
    notes: 'Multiple affected comparisons in one file must each produce their own finding.',
  },
  {
    id: 'issuing-authorization-status-positive-nested-workspace',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'control',
    files: {
      'packages/billing/package.json': packageJsonWithStripe('^18.0.0'),
      'packages/billing/package-lock.json': packageLockWithStripe('18.2.0'),
      'packages/billing/src/issuing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function isReversed(id: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(id);',
        "  return authorization.status === 'reversed';",
        '}',
      ].join('\n'),
      'packages/web/package.json': JSON.stringify({ dependencies: {} }),
      'packages/web/src/index.ts': 'export const x = 1;',
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes: 'A monorepo workspace with the affected usage should still resolve to AFFECTED.',
  },

  // --- NEGATIVE -------------------------------------------------------------
  {
    id: 'issuing-authorization-status-negative-unrelated-object',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/other.ts': [
        'const job = { status: "reversed" as string };',
        "const wasReversed = job.status === 'reversed';",
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'Same property name and literal on an unrelated object must be rejected.',
  },
  {
    id: 'issuing-authorization-status-negative-comment-only',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/notes.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '// authorizations used to report reversed instead of expired',
        'const note = "status can be reversed";',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'The literal/property appearing only in a comment/string is not a usage.',
  },
  {
    id: 'issuing-authorization-status-negative-feature-unused',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/issuing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function isClosed(id: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(id);',
        "  return authorization.status === 'closed';",
        '}',
        '// reversed appears here only so the prefilter still scans this file',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes: 'Stripe is present and applicable, but this comparison is against a different value.',
  },
  {
    id: 'issuing-authorization-status-negative-pre-boundary-api-version',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^17.0.0'),
      'package-lock.json': packageLockWithStripe('17.7.0'),
      'src/issuing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: '2024-06-20.acacia' });",
        'async function isReversed(id: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(id);',
        "  return authorization.status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes:
      'Shares the same applicability boundary as the retrieveUpcoming/invoice-subscription ' +
      "rules -- on pre-Basil versions, 'expired' was never split out, so the legacy comparison " +
      'is still correct behavior, not a bug.',
  },

  // --- UNCERTAIN --------------------------------------------------------------
  {
    id: 'issuing-authorization-status-uncertain-dynamic-construction',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/dynamic.ts': [
        'function getCtor(): any { return null; }',
        'const StripeCtor = getCtor();',
        "const stripe = new StripeCtor('sk_test');",
        'async function isReversed(id: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(id);',
        "  return authorization.status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes: 'Dynamic client construction cannot be proven to originate from the stub either way.',
  },
  {
    id: 'issuing-authorization-status-uncertain-unresolved-import',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/wrapper.ts': [
        "import { getAuthorization } from './issuing-helpers';",
        'async function isReversed(id: string) {',
        '  const authorization = await getAuthorization(id);',
        "  return authorization.status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes: "getAuthorization's return type lives in a file we never extracted -- unresolvable.",
  },
  {
    id: 'issuing-authorization-status-uncertain-unknown-version',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'control',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'src/issuing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function isReversed(id: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(id);',
        "  return authorization.status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes: 'No lockfile at all -- applicability is genuinely UNKNOWN despite a confirmed match.',
  },
];
