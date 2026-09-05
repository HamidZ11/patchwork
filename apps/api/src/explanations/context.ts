import { createHash } from 'node:crypto';
import type { ExplanationContext } from './types.js';

/** Caps that keep the prompt small and its cost bounded regardless of how
 * large a repository's evidence is. The real totals are still sent as counts,
 * so truncation never makes the model understate the impact. */
const MAX_FINDINGS = 5;
const MAX_WORKSPACES = 5;

export interface ExplanationContextSource {
  status: string;
  providerChangeTitle: string;
  providerChangeSourceUrl: string;
  migrationRequirement: string;
  coverage: {
    workspaces: {
      workspacePath: string;
      applicability: string;
      applicabilityReason: string;
    }[];
  } | null;
  installedSdks: {
    workspacePath: string;
    declaredRange: string;
    resolvedVersion: string | null;
  }[];
  findings: { sourceFile: string; line: number; matchedSymbol: string }[];
  remediationSupported: boolean;
  latestPatchAttemptStatus: string | null;
  latestVerificationStatus: string | null;
  verificationSteps: { kind: string; status: string; notRun: boolean }[];
  pullRequest: { exists: boolean; status: string | null };
}

/**
 * Builds the model input from already-persisted facts. Pure and total: no
 * I/O, no source files, no credentials, no analyzer re-entry. Deliberately
 * a projection rather than a pass-through of the assessment DTO -- passing
 * everything would send fields the explanation cannot use and would make the
 * cache key churn on values that do not change the explanation.
 */
export function buildExplanationContext(source: ExplanationContextSource): ExplanationContext {
  return {
    verdict: source.status === 'AFFECTED' ? 'AFFECTED' : 'UNCERTAIN',
    providerChange: {
      title: source.providerChangeTitle,
      sourceUrl: source.providerChangeSourceUrl,
    },
    applicability: (source.coverage?.workspaces ?? [])
      .slice(0, MAX_WORKSPACES)
      .map((workspace) => ({
        workspacePath: workspace.workspacePath,
        applicability: workspace.applicability,
        reason: workspace.applicabilityReason,
      })),
    installedStripeSdk: source.installedSdks.slice(0, MAX_WORKSPACES).map((sdk) => ({
      workspacePath: sdk.workspacePath,
      declaredRange: sdk.declaredRange,
      resolvedVersion: sdk.resolvedVersion,
    })),
    findings: source.findings.slice(0, MAX_FINDINGS).map((finding) => ({
      sourceFile: finding.sourceFile,
      line: finding.line,
      matchedSymbol: finding.matchedSymbol,
    })),
    findingsCount: source.findings.length,
    migrationRequirement: source.migrationRequirement,
    remediation: {
      supported: source.remediationSupported,
      latestAttemptStatus: source.latestPatchAttemptStatus,
    },
    verification: {
      status: source.latestVerificationStatus,
      steps: source.verificationSteps,
    },
    pullRequest: source.pullRequest,
  };
}

/**
 * Stable SHA-256 over the context, used as part of the cache identity.
 *
 * This exists because an ImpactAssessment is mutable: `upsertImpactAssessment`
 * rewrites status, reason, coverage and findings on the SAME row when a
 * repository is re-analysed. Keying the cache on the assessment id alone
 * would keep serving an explanation of a verdict that no longer holds. Hashing
 * the exact facts means a changed verdict changes the key, and a re-analysis
 * that changed nothing still costs nothing.
 *
 * Keys are sorted recursively so an equivalent object always hashes the same
 * regardless of property insertion order.
 */
export function hashExplanationContext(context: ExplanationContext): string {
  return createHash('sha256').update(canonicalJson(context)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
