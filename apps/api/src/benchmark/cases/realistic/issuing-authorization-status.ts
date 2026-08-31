import type { BenchmarkCase } from '../../types.js';
import { STRIPE_IMPORT, packageJsonWithStripe, packageLockWithStripe } from '../fixture-helpers.js';

const RULE_ID = 'basil-2025-03-31-issuing-authorizations-expired';

/**
 * Realistic-shape validation for Rule D (Issuing Authorization.status
 * gains 'expired'), prioritized per the task alongside Rule B -- both
 * depend on the awaited-property/literal analysis path that exposed the
 * Promise<T> gap in slice 4. Ground truth is derived from the change
 * semantics and source code independently -- never inferred from running
 * the analyser.
 */
export const REALISTIC_ISSUING_AUTHORIZATION_STATUS_CASES: BenchmarkCase[] = [
  // --- AFFECTED (realistic shape) ------------------------------------------
  {
    id: 'realistic-issuing-authorization-status-nested-service',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/issuingService.ts': [
        STRIPE_IMPORT,
        'const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);',
        '',
        'export async function wasAuthorizationReversed(authorizationId: string): Promise<boolean> {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(authorizationId);',
        "  return authorization.status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: {
      status: 'AFFECTED',
      findingCount: 1,
      findingLocations: [{ sourceFile: 'src/services/issuingService.ts', line: 6 }],
    },
    notes:
      'Rule: Issuing Authorization.status expired split. Affected: a real async service module, ' +
      "in a nested src/services/ directory, compares status against the legacy 'reversed' " +
      'value -- re-validates the Promise<T> fix under realistic surrounding code.',
  },
  {
    id: 'realistic-issuing-authorization-status-cross-file-client-singleton',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/clients/stripeClient.ts': [
        STRIPE_IMPORT,
        'export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);',
      ].join('\n'),
      'src/services/issuingService.ts': [
        "import { stripe } from '../clients/stripeClient';",
        '',
        'export async function wasAuthorizationReversed(authorizationId: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(authorizationId);',
        "  return authorization.status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes:
      'Rule: Issuing Authorization.status expired split. Uncertain: a shared Stripe client ' +
      "singleton imported from its own module -- each candidate file's analysis Program is " +
      "bounded to just that file plus the trusted stub, so the imported `stripe` binding's real " +
      'type is unresolvable from issuingService.ts alone. Correctly UNCERTAIN, not a guess in ' +
      'either direction.',
  },
  {
    id: 'realistic-issuing-authorization-status-destructured',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/issuingService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        'export async function isReversed(authorizationId: string) {',
        '  const { status } = await stripe.issuing.authorizations.retrieve(authorizationId);',
        "  return status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes:
      'Rule: Issuing Authorization.status expired split. Affected: destructuring the awaited ' +
      'Authorization before comparing status is an ordinary, extremely common real-world pattern. ' +
      "This case is the concrete, empirically-confirmed gap this slice's literal-comparison.ts fix " +
      'addresses (previously silent NOT_AFFECTED).',
  },
  {
    id: 'realistic-issuing-authorization-status-destructured-renamed',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/issuingService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        'export async function isReversed(authorizationId: string) {',
        '  const { status: authorizationStatus } = await stripe.issuing.authorizations.retrieve(authorizationId);',
        "  return authorizationStatus === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes:
      'Rule: Issuing Authorization.status expired split. Affected: destructuring with a rename is ' +
      'just as much a real usage as the shorthand form.',
  },
  {
    id: 'realistic-issuing-authorization-status-partial-migration',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/issuingService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        '// TODO(migration): most call sites already check for expired explicitly;',
        '// this dashboard widget has not been updated yet.',
        'export async function isReversedLegacy(authorizationId: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(authorizationId);',
        "  return authorization.status === 'reversed';",
        '}',
        '',
        'export async function describeStatus(authorizationId: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(authorizationId);',
        "  if (authorization.status === 'expired') return 'expired';",
        "  if (authorization.status === 'closed') return 'closed';",
        "  return 'pending';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes:
      'Rule: Issuing Authorization.status expired split. Affected: a repository partway through ' +
      "migration -- one function already handles 'expired' explicitly, a sibling function still " +
      "uses the legacy 'reversed' comparison. The legacy comparison alone is enough to warrant " +
      'AFFECTED and review, regardless of what other code in the same file already does.',
  },
  {
    id: 'realistic-issuing-authorization-status-mixed-workspace-version-evidence',
    ruleExternalId: RULE_ID,
    category: 'POSITIVE',
    corpus: 'realistic',
    files: {
      'packages/payments-api/package.json': packageJsonWithStripe('^18.0.0'),
      'packages/payments-api/package-lock.json': packageLockWithStripe('18.2.0'),
      'packages/payments-api/src/services/issuingService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: '2025-06-30.basil' });",
        '',
        'export async function isReversed(authorizationId: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(authorizationId);',
        "  return authorization.status === 'reversed';",
        '}',
      ].join('\n'),
      'packages/fraud-worker/package.json': packageJsonWithStripe('^18.0.0'),
      'packages/fraud-worker/package-lock.json': packageLockWithStripe('18.2.0'),
      'packages/fraud-worker/src/scan.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test', { apiVersion: process.env.STRIPE_API_VERSION as string });",
        'export async function scanAuthorization(id: string) {',
        '  return stripe.issuing.authorizations.retrieve(id);',
        '}',
      ].join('\n'),
    },
    expected: { status: 'AFFECTED', findingCount: 1 },
    notes:
      'Rule: Issuing Authorization.status expired split. Affected: a realistic monorepo where one ' +
      'workspace pins an explicit apiVersion literal on/after the Basil boundary (APPLICABLE + a ' +
      'confirmed match -> AFFECTED for that workspace), and a sibling workspace reads apiVersion ' +
      'from an environment variable (DYNAMIC_UNKNOWN, no other evidence -> UNCERTAIN for that ' +
      'workspace). AFFECTED-in-one-workspace precedence means the aggregate is AFFECTED.',
  },

  // --- UNCERTAIN (realistic shape, documented limitations) -----------------
  {
    id: 'realistic-issuing-authorization-status-cross-file-layering',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/issuingService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'export async function fetchAuthorization(id: string) {',
        '  return stripe.issuing.authorizations.retrieve(id);',
        '}',
      ].join('\n'),
      'src/controllers/disputeController.ts': [
        "import { fetchAuthorization } from '../services/issuingService';",
        '',
        'export async function isReversed(id: string) {',
        '  const authorization = await fetchAuthorization(id);',
        "  return authorization.status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes:
      "Rule: Issuing Authorization.status expired split. Uncertain: fetchAuthorization's return " +
      'type lives in a different file from where the comparison happens -- realistic service/' +
      'controller layering, but cross-file return-type resolution is a documented, accepted ' +
      'limitation. Must abstain safely, not guess NOT_AFFECTED.',
  },
  {
    id: 'realistic-issuing-authorization-status-namespace-type-annotation',
    ruleExternalId: RULE_ID,
    category: 'UNCERTAIN',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/issuingService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        '// A common real stripe-node pattern: an explicit Stripe.Issuing.Authorization',
        '// type annotation on a helper parameter.',
        'function wasReversed(authorization: Stripe.Issuing.Authorization): boolean {',
        "  return authorization.status === 'reversed';",
        '}',
        '',
        'export async function isReversed(id: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(id);',
        '  return wasReversed(authorization);',
        '}',
      ].join('\n'),
    },
    expected: { status: 'UNCERTAIN' },
    notes:
      'Rule: Issuing Authorization.status expired split. Uncertain (documented, deliberately not ' +
      'fixed this slice): the trusted stub declares only a default-exported class, not stripe-' +
      "node's real merged Stripe namespace, so an explicit `Stripe.Issuing.Authorization` type " +
      "annotation cannot resolve. wasReversed's own comparison is correctly UNCERTAIN rather than " +
      'a false match or a false negative -- a stub-coverage gap, not a predicate-logic bug.',
  },

  // --- NOT_AFFECTED (realistic shape) ---------------------------------------
  {
    id: 'realistic-issuing-authorization-status-unrelated-domain-model',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/issuingService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        'export async function getAuthorization(authorizationId: string) {',
        '  return stripe.issuing.authorizations.retrieve(authorizationId);',
        '}',
      ].join('\n'),
      'src/models/jobQueue.ts': [
        '// An internal background-job model, unrelated to Stripe, that happens',
        '// to share both a property name and a literal value with the',
        '// Issuing Authorization change.',
        "export type JobStatus = 'pending' | 'closed' | 'reversed';",
        'export interface Job {',
        '  status: JobStatus;',
        '}',
        '',
        'export function wasReversed(job: Job): boolean {',
        "  return job.status === 'reversed';",
        '}',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes:
      'Rule: Issuing Authorization.status expired split. Not affected: real Stripe usage exists ' +
      'elsewhere in the project, but this comparison belongs to an unrelated, locally-defined ' +
      'Job type that happens to share both the property name and the literal value -- must be ' +
      'rejected by real provenance, not a lexical match.',
  },
  {
    id: 'realistic-issuing-authorization-status-feature-genuinely-unused',
    ruleExternalId: RULE_ID,
    category: 'NEGATIVE',
    corpus: 'realistic',
    files: {
      'package.json': packageJsonWithStripe('^18.0.0'),
      'package-lock.json': packageLockWithStripe('18.2.0'),
      'src/services/issuingService.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        '',
        '// this dashboard only reports the raw status value; it never',
        "// special-cases 'reversed' -- so 'reversed' is mentioned here only",
        '// so the prefilter still scans this file.',
        'export async function getAuthorizationStatus(authorizationId: string) {',
        '  const authorization = await stripe.issuing.authorizations.retrieve(authorizationId);',
        '  return authorization.status;',
        '}',
      ].join('\n'),
    },
    expected: { status: 'NOT_AFFECTED', findingCount: 0 },
    notes:
      'Rule: Issuing Authorization.status expired split. Not affected: Stripe is present, ' +
      "applicable, and status is read, but it is never compared against the legacy 'reversed' " +
      'literal anywhere in the project.',
  },
];
