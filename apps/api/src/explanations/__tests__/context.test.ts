import { describe, expect, it } from 'vitest';
import { buildExplanationContext, hashExplanationContext } from '../context.js';
import { parseExplanation, ExplanationModelError } from '../openai.js';
import type { ExplanationContextSource } from '../context.js';

function source(overrides: Partial<ExplanationContextSource> = {}): ExplanationContextSource {
  return {
    status: 'AFFECTED',
    providerChangeTitle: 'Removes Invoice.subscription',
    providerChangeSourceUrl: 'https://docs.stripe.com/changelog/example',
    migrationRequirement: 'Use invoice.parent.subscription_details.subscription instead.',
    coverage: {
      workspaces: [
        { workspacePath: '.', applicability: 'APPLIES', applicabilityReason: 'stripe 18.2.0' },
      ],
    },
    installedSdks: [{ workspacePath: '.', declaredRange: '^18.0.0', resolvedVersion: '18.2.0' }],
    findings: [{ sourceFile: 'src/billing.ts', line: 5, matchedSymbol: 'invoice.subscription' }],
    remediationSupported: true,
    latestPatchAttemptStatus: null,
    latestVerificationStatus: null,
    verificationSteps: [],
    pullRequest: { exists: false, status: null },
    ...overrides,
  };
}

describe('buildExplanationContext', () => {
  it('caps findings and workspaces but still reports the real total', () => {
    const findings = Array.from({ length: 12 }, (_, i) => ({
      sourceFile: `src/file-${i}.ts`,
      line: i,
      matchedSymbol: 'invoice.subscription',
    }));
    const context = buildExplanationContext(source({ findings }));

    expect(context.findings).toHaveLength(5);
    // Truncating the sample must never understate the impact.
    expect(context.findingsCount).toBe(12);
  });

  it('maps any non-AFFECTED explainable status to UNCERTAIN, never to a lean', () => {
    expect(buildExplanationContext(source({ status: 'UNCERTAIN' })).verdict).toBe('UNCERTAIN');
  });

  it('passes remediation, verification and pull-request state through unchanged', () => {
    const context = buildExplanationContext(
      source({
        remediationSupported: false,
        latestPatchAttemptStatus: 'REFUSED',
        latestVerificationStatus: 'FAILED',
        verificationSteps: [{ kind: 'test', status: 'SKIPPED', notRun: true }],
        pullRequest: { exists: false, status: 'REFUSED' },
      }),
    );

    expect(context.remediation).toEqual({ supported: false, latestAttemptStatus: 'REFUSED' });
    expect(context.verification.status).toBe('FAILED');
    expect(context.verification.steps[0]?.notRun).toBe(true);
    expect(context.pullRequest).toEqual({ exists: false, status: 'REFUSED' });
  });
});

describe('hashExplanationContext', () => {
  it('is stable for equivalent contexts regardless of key order', () => {
    const a = buildExplanationContext(source());
    const b = buildExplanationContext(source());
    expect(hashExplanationContext(a)).toBe(hashExplanationContext(b));
  });

  /**
   * The reason the hash is part of the cache key at all: an ImpactAssessment
   * is rewritten in place by re-analysis, so a cache keyed on its id alone
   * would keep serving an explanation of a verdict that no longer holds.
   */
  it('changes when the verdict changes, so a stale explanation cannot be reused', () => {
    const affected = hashExplanationContext(buildExplanationContext(source()));
    const uncertain = hashExplanationContext(
      buildExplanationContext(source({ status: 'UNCERTAIN' })),
    );
    expect(uncertain).not.toBe(affected);
  });

  it('changes when the findings change', () => {
    const before = hashExplanationContext(buildExplanationContext(source()));
    const after = hashExplanationContext(
      buildExplanationContext(
        source({
          findings: [
            { sourceFile: 'src/other.ts', line: 9, matchedSymbol: 'invoice.subscription' },
          ],
        }),
      ),
    );
    expect(after).not.toBe(before);
  });

  it('changes when remediation availability changes', () => {
    const before = hashExplanationContext(buildExplanationContext(source()));
    const after = hashExplanationContext(
      buildExplanationContext(source({ remediationSupported: false })),
    );
    expect(after).not.toBe(before);
  });
});

describe('parseExplanation', () => {
  it('accepts a well-formed structured response', () => {
    const parsed = parseExplanation(
      JSON.stringify({ summary: 'a', whyItMatters: 'b', nextStep: 'c' }),
    );
    expect(parsed).toEqual({ summary: 'a', whyItMatters: 'b', nextStep: 'c' });
  });

  it('rejects malformed JSON (a truncated response) rather than persisting it', () => {
    expect(() => parseExplanation('{"summary": "a"')).toThrow(ExplanationModelError);
  });

  it('rejects a missing field', () => {
    expect(() => parseExplanation(JSON.stringify({ summary: 'a', whyItMatters: 'b' }))).toThrow(
      ExplanationModelError,
    );
  });

  it('rejects an empty field, which would render as a blank labelled section', () => {
    expect(() =>
      parseExplanation(JSON.stringify({ summary: '', whyItMatters: 'b', nextStep: 'c' })),
    ).toThrow(ExplanationModelError);
  });

  it('rejects an over-long field rather than letting an essay into the UI', () => {
    expect(() =>
      parseExplanation(
        JSON.stringify({ summary: 'x'.repeat(401), whyItMatters: 'b', nextStep: 'c' }),
      ),
    ).toThrow(ExplanationModelError);
  });
});
