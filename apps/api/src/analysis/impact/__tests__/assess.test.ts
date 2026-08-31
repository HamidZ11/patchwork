import { describe, expect, it } from 'vitest';
import type { ExtractedFile } from '../../archive.js';
import type { StripeEvidence } from '../../evidence/types.js';
import { assessRetrieveUpcomingImpact } from '../assess.js';

function file(path: string, content: string): ExtractedFile {
  return { path, content };
}

function evidence(overrides: Partial<StripeEvidence> = {}): StripeEvidence {
  return {
    schemaVersion: 1,
    installedSdks: [],
    clientVersions: [],
    accountVersion: { status: 'UNKNOWN', reason: 'no api call' },
    webhookVersion: { status: 'OUT_OF_SCOPE', reason: 'not analyzed' },
    coverage: {
      archiveAcquired: true,
      manifestsDiscovered: 1,
      workspaceConfigDiscovered: 'none',
      lockfilesDiscovered: [],
      lockfilesParsed: [],
      lockfilesUnsupported: [],
      sourceFilesScanned: 0,
      sourceFilesTruncated: false,
      parseFailures: [],
    },
    ...overrides,
  };
}

const STRIPE_IMPORT = "import Stripe from 'stripe';";

function applicableEvidence(): StripeEvidence {
  return evidence({
    installedSdks: [
      {
        packageName: 'stripe',
        workspacePath: '',
        manifestPath: 'package.json',
        dependencyField: 'dependencies',
        declaredRange: '^18.0.0',
        resolvedVersion: '18.2.0',
        resolutionStatus: 'EXACT',
        evidenceSources: ['package.json', 'package-lock.json'],
      },
    ],
  });
}

describe('assessRetrieveUpcomingImpact', () => {
  it('is NOT_AFFECTED when applicable, no match found, and coverage is complete', () => {
    const files = [file('package.json', '{}'), file('src/other.ts', 'export const x = 1;')];
    const result = assessRetrieveUpcomingImpact(applicableEvidence(), files, {
      sourceFilesTruncated: false,
    });
    expect(result.status).toBe('NOT_AFFECTED');
    expect(result.findings).toHaveLength(0);
  });

  it('is AFFECTED when applicable and a confirmed match is found', () => {
    const files = [
      file('package.json', '{}'),
      file(
        'src/billing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.invoices.retrieveUpcoming({});',
        ].join('\n'),
      ),
    ];
    const result = assessRetrieveUpcomingImpact(applicableEvidence(), files, {
      sourceFilesTruncated: false,
    });
    expect(result.status).toBe('AFFECTED');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      sourceFile: 'src/billing.ts',
      matchedSymbol: 'stripe.invoices.retrieveUpcoming',
    });
  });

  it('is UNCERTAIN when applicable but coverage is incomplete (ambiguous reference)', () => {
    const files = [
      file('package.json', '{}'),
      file(
        'src/dynamic.ts',
        [
          'function getCtor(): any { return null; }',
          'const StripeCtor = getCtor();',
          "const stripe = new StripeCtor('sk_test');",
          'stripe.invoices.retrieveUpcoming({});',
        ].join('\n'),
      ),
    ];
    const result = assessRetrieveUpcomingImpact(applicableEvidence(), files, {
      sourceFilesTruncated: false,
    });
    expect(result.status).toBe('UNCERTAIN');
  });

  it('is NOT_AFFECTED when applicability is provably NOT_APPLICABLE, regardless of predicate', () => {
    const preBasilEvidence = evidence({
      installedSdks: [
        {
          packageName: 'stripe',
          workspacePath: '',
          manifestPath: 'package.json',
          dependencyField: 'dependencies',
          declaredRange: '^17.0.0',
          resolvedVersion: '17.7.0',
          resolutionStatus: 'EXACT',
          evidenceSources: ['package.json'],
        },
      ],
      clientVersions: [
        {
          workspacePath: '',
          sourceFile: 'src/stripe.ts',
          line: 1,
          apiVersion: '2024-06-20.acacia',
          valueKind: 'LITERAL',
        },
      ],
    });
    // Even though the predicate would find a real match, pre-Basil
    // pinning is a legitimate negative proof on its own.
    const files = [
      file('package.json', '{}'),
      file(
        'src/billing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.invoices.retrieveUpcoming({});',
        ].join('\n'),
      ),
    ];
    const result = assessRetrieveUpcomingImpact(preBasilEvidence, files, {
      sourceFilesTruncated: false,
    });
    expect(result.status).toBe('NOT_AFFECTED');
  });

  it('caps at UNCERTAIN when applicability is UNKNOWN, even if the predicate finds a match', () => {
    const unknownApplicabilityEvidence = evidence({
      installedSdks: [
        {
          packageName: 'stripe',
          workspacePath: '',
          manifestPath: 'package.json',
          dependencyField: 'dependencies',
          declaredRange: '^17.0.0',
          resolvedVersion: null,
          resolutionStatus: 'DECLARED_ONLY',
          evidenceSources: ['package.json'],
        },
      ],
    });
    const files = [
      file('package.json', '{}'),
      file(
        'src/billing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.invoices.retrieveUpcoming({});',
        ].join('\n'),
      ),
    ];
    const result = assessRetrieveUpcomingImpact(unknownApplicabilityEvidence, files, {
      sourceFilesTruncated: false,
    });
    // Insufficient applicability evidence caps the result at UNCERTAIN --
    // never overridden by an independently-found predicate match.
    expect(result.status).toBe('UNCERTAIN');
  });

  it('AFFECTED in one workspace wins over UNCERTAIN in another (worst case does not suppress proven findings)', () => {
    const multiWorkspaceEvidence = evidence({
      installedSdks: [
        {
          packageName: 'stripe',
          workspacePath: 'packages/affected',
          manifestPath: 'packages/affected/package.json',
          dependencyField: 'dependencies',
          declaredRange: '^18.0.0',
          resolvedVersion: '18.2.0',
          resolutionStatus: 'EXACT',
          evidenceSources: ['packages/affected/package.json'],
        },
        {
          packageName: 'stripe',
          workspacePath: 'packages/unknown',
          manifestPath: 'packages/unknown/package.json',
          dependencyField: 'dependencies',
          declaredRange: '^17.0.0',
          resolvedVersion: null,
          resolutionStatus: 'DECLARED_ONLY',
          evidenceSources: ['packages/unknown/package.json'],
        },
      ],
    });
    const files = [
      file('packages/affected/package.json', '{}'),
      file('packages/unknown/package.json', '{}'),
      file(
        'packages/affected/src/billing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.invoices.retrieveUpcoming({});',
        ].join('\n'),
      ),
      file('packages/unknown/src/other.ts', 'export const x = 1;'),
    ];
    const result = assessRetrieveUpcomingImpact(multiWorkspaceEvidence, files, {
      sourceFilesTruncated: false,
    });
    expect(result.status).toBe('AFFECTED');
    expect(result.findings).toHaveLength(1);
  });

  it('downgrades an otherwise-NOT_AFFECTED result to UNCERTAIN when archive extraction was truncated', () => {
    const files = [file('package.json', '{}'), file('src/other.ts', 'export const x = 1;')];
    const result = assessRetrieveUpcomingImpact(applicableEvidence(), files, {
      sourceFilesTruncated: true,
    });
    expect(result.status).toBe('UNCERTAIN');
  });

  it('does not downgrade an AFFECTED result when archive extraction was truncated', () => {
    const files = [
      file('package.json', '{}'),
      file(
        'src/billing.ts',
        [
          STRIPE_IMPORT,
          "const stripe = new Stripe('sk_test');",
          'stripe.invoices.retrieveUpcoming({});',
        ].join('\n'),
      ),
    ];
    const result = assessRetrieveUpcomingImpact(applicableEvidence(), files, {
      sourceFilesTruncated: true,
    });
    expect(result.status).toBe('AFFECTED');
  });

  it('is NOT_AFFECTED when there is no Stripe dependency evidence at all', () => {
    const files = [file('package.json', '{}')];
    const result = assessRetrieveUpcomingImpact(evidence(), files, { sourceFilesTruncated: false });
    expect(result.status).toBe('NOT_AFFECTED');
  });
});
