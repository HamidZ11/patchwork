import { describe, expect, it } from 'vitest';
import type { StripeEvidence } from '../../evidence/types.js';
import { computeApplicability, type ApplicabilityConfig } from '../applicability.js';

const BASIL_CONFIG: ApplicabilityConfig = {
  sdkBoundaryMajor: 18,
  apiVersionBoundaryDate: '2025-03-31',
  changeDescription: 'the affected surface was removed from the SDK',
};

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

describe('computeApplicability', () => {
  it('is APPLICABLE when the exactly-resolved SDK version is >= 18.0.0', () => {
    const result = computeApplicability(
      evidence({
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
      }),
      BASIL_CONFIG,
    );

    expect(result).toEqual([
      expect.objectContaining({ workspacePath: '', applicability: 'APPLICABLE' }),
    ]);
  });

  it('is NOT_APPLICABLE when the exactly-resolved SDK version is < 18.0.0 and no apiVersion evidence exists', () => {
    // Below 18.0.0 the method still exists in the SDK and no apiVersion
    // pins the account to Basil-or-later, so this correctly falls to
    // UNKNOWN, not NOT_APPLICABLE -- see the dedicated UNKNOWN test below.
    // This test instead exercises a pre-Basil apiVersion pin.
    const result = computeApplicability(
      evidence({
        installedSdks: [
          {
            packageName: 'stripe',
            workspacePath: '',
            manifestPath: 'package.json',
            dependencyField: 'dependencies',
            declaredRange: '^17.0.0',
            resolvedVersion: '17.7.0',
            resolutionStatus: 'EXACT',
            evidenceSources: ['package.json', 'package-lock.json'],
          },
        ],
        clientVersions: [
          {
            workspacePath: '',
            sourceFile: 'src/stripe.ts',
            line: 3,
            apiVersion: '2024-06-20.acacia',
            valueKind: 'LITERAL',
          },
        ],
      }),
      BASIL_CONFIG,
    );

    expect(result).toEqual([
      expect.objectContaining({ workspacePath: '', applicability: 'NOT_APPLICABLE' }),
    ]);
  });

  it('is APPLICABLE when an explicit apiVersion is on/after 2025-03-31.basil, even on an old SDK version', () => {
    const result = computeApplicability(
      evidence({
        installedSdks: [
          {
            packageName: 'stripe',
            workspacePath: '',
            manifestPath: 'package.json',
            dependencyField: 'dependencies',
            declaredRange: '^17.0.0',
            resolvedVersion: '17.7.0',
            resolutionStatus: 'EXACT',
            evidenceSources: ['package.json', 'package-lock.json'],
          },
        ],
        clientVersions: [
          {
            workspacePath: '',
            sourceFile: 'src/stripe.ts',
            line: 3,
            apiVersion: '2025-03-31.basil',
            valueKind: 'LITERAL',
          },
        ],
      }),
      BASIL_CONFIG,
    );

    expect(result).toEqual([
      expect.objectContaining({ workspacePath: '', applicability: 'APPLICABLE' }),
    ]);
  });

  it('is UNKNOWN when SDK resolution and apiVersion are both unresolved', () => {
    const result = computeApplicability(
      evidence({
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
      }),
      BASIL_CONFIG,
    );

    expect(result).toEqual([
      expect.objectContaining({ workspacePath: '', applicability: 'UNKNOWN' }),
    ]);
  });

  it('is UNKNOWN when conflicting apiVersion evidence disagrees on the Basil boundary', () => {
    const result = computeApplicability(
      evidence({
        clientVersions: [
          {
            workspacePath: '',
            sourceFile: 'src/a.ts',
            line: 1,
            apiVersion: '2024-06-20.acacia',
            valueKind: 'LITERAL',
          },
          {
            workspacePath: '',
            sourceFile: 'src/b.ts',
            line: 1,
            apiVersion: '2025-06-30.basil',
            valueKind: 'LITERAL',
          },
        ],
      }),
      BASIL_CONFIG,
    );

    expect(result).toEqual([
      expect.objectContaining({ workspacePath: '', applicability: 'UNKNOWN' }),
    ]);
  });

  it('is NOT_APPLICABLE when there is no Stripe dependency evidence at all', () => {
    const result = computeApplicability(evidence(), BASIL_CONFIG);
    expect(result).toEqual([
      expect.objectContaining({ workspacePath: '', applicability: 'NOT_APPLICABLE' }),
    ]);
  });

  it('does not collapse multiple workspaces into one applicability result', () => {
    const result = computeApplicability(
      evidence({
        installedSdks: [
          {
            packageName: 'stripe',
            workspacePath: 'packages/a',
            manifestPath: 'packages/a/package.json',
            dependencyField: 'dependencies',
            declaredRange: '^18.0.0',
            resolvedVersion: '18.2.0',
            resolutionStatus: 'EXACT',
            evidenceSources: ['packages/a/package.json'],
          },
          {
            packageName: 'stripe',
            workspacePath: 'packages/b',
            manifestPath: 'packages/b/package.json',
            dependencyField: 'dependencies',
            declaredRange: '^17.0.0',
            resolvedVersion: '17.7.0',
            resolutionStatus: 'EXACT',
            evidenceSources: ['packages/b/package.json'],
          },
        ],
      }),
      BASIL_CONFIG,
    );

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.workspacePath === 'packages/a')?.applicability).toBe('APPLICABLE');
    expect(result.find((r) => r.workspacePath === 'packages/b')?.applicability).toBe('UNKNOWN');
  });

  it('generalizes to a second, different boundary (SDK v19 / Clover), not just the Basil one', () => {
    const CLOVER_CONFIG: ApplicabilityConfig = {
      sdkBoundaryMajor: 19,
      apiVersionBoundaryDate: '2025-09-30',
      changeDescription: 'the iterations parameter was removed from the SDK',
    };

    const applicableResult = computeApplicability(
      evidence({
        installedSdks: [
          {
            packageName: 'stripe',
            workspacePath: '',
            manifestPath: 'package.json',
            dependencyField: 'dependencies',
            declaredRange: '^19.0.0',
            resolvedVersion: '19.1.0',
            resolutionStatus: 'EXACT',
            evidenceSources: ['package.json', 'package-lock.json'],
          },
        ],
      }),
      CLOVER_CONFIG,
    );
    expect(applicableResult).toEqual([
      expect.objectContaining({ workspacePath: '', applicability: 'APPLICABLE' }),
    ]);

    // Same SDK version is NOT applicable under the Basil rules' earlier
    // boundary check for a *different* rule's config -- proves the
    // boundary is genuinely a per-rule parameter, not a global constant.
    const notApplicableUnderClover = computeApplicability(
      evidence({
        installedSdks: [
          {
            packageName: 'stripe',
            workspacePath: '',
            manifestPath: 'package.json',
            dependencyField: 'dependencies',
            declaredRange: '^18.5.0',
            resolvedVersion: '18.5.0',
            resolutionStatus: 'EXACT',
            evidenceSources: ['package.json', 'package-lock.json'],
          },
        ],
        clientVersions: [
          {
            workspacePath: '',
            sourceFile: 'src/stripe.ts',
            line: 1,
            apiVersion: '2025-06-30.basil',
            valueKind: 'LITERAL',
          },
        ],
      }),
      CLOVER_CONFIG,
    );
    expect(notApplicableUnderClover).toEqual([
      expect.objectContaining({ workspacePath: '', applicability: 'NOT_APPLICABLE' }),
    ]);
  });
});
