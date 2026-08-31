import type { StripeEvidence } from '../evidence/types.js';
import type { Applicability } from './types.js';

/**
 * Which SDK/API-version boundary makes a rule applicable. Both fields
 * optional: a rule that's only detectable via SDK version (no known
 * apiVersion boundary) omits `apiVersionBoundaryDate`, and vice versa --
 * but at least one should normally be set, or applicability can never
 * resolve past UNKNOWN.
 */
export interface ApplicabilityConfig {
  /** stripe-node major version at/above which the change is unconditionally applicable. */
  sdkBoundaryMajor?: number;
  /** Stripe API version date (YYYY-MM-DD) at/after which the change applies. */
  apiVersionBoundaryDate?: string;
  /** Short description of the change, used in human-readable reason text. */
  changeDescription: string;
}

export interface WorkspaceApplicability {
  workspacePath: string;
  applicability: Applicability;
  reason: string;
}

function majorVersion(version: string): number | null {
  const match = /^(\d+)\./.exec(version);
  return match ? Number(match[1]) : null;
}

function apiVersionDatePrefix(apiVersion: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(apiVersion);
  return match?.[1] ?? null;
}

function computeForWorkspace(
  workspacePath: string,
  evidence: StripeEvidence,
  config: ApplicabilityConfig,
): WorkspaceApplicability {
  const sdk = evidence.installedSdks.find((entry) => entry.workspacePath === workspacePath);

  // SDK version is dominant when known exactly: the affected surface is
  // entirely absent from/present in the installed library, independent
  // of apiVersion pinning.
  if (
    config.sdkBoundaryMajor !== undefined &&
    sdk &&
    sdk.resolutionStatus === 'EXACT' &&
    sdk.resolvedVersion
  ) {
    const major = majorVersion(sdk.resolvedVersion);
    if (major !== null && major >= config.sdkBoundaryMajor) {
      return {
        workspacePath,
        applicability: 'APPLICABLE',
        reason: `stripe@${sdk.resolvedVersion} is installed; ${config.changeDescription} at v${config.sdkBoundaryMajor}.0.0.`,
      };
    }
  }

  // Fall through to explicit apiVersion evidence in this workspace.
  if (config.apiVersionBoundaryDate !== undefined) {
    const boundaryDate = config.apiVersionBoundaryDate;
    const resolvedDates = evidence.clientVersions
      .filter((entry) => entry.workspacePath === workspacePath)
      .filter((entry) => entry.valueKind === 'LITERAL' || entry.valueKind === 'LOCAL_CONSTANT')
      .map((entry) => (entry.apiVersion ? apiVersionDatePrefix(entry.apiVersion) : null))
      .filter((date): date is string => date !== null);

    if (resolvedDates.length > 0) {
      const allApplicable = resolvedDates.every((date) => date >= boundaryDate);
      const allNotApplicable = resolvedDates.every((date) => date < boundaryDate);

      if (allApplicable) {
        return {
          workspacePath,
          applicability: 'APPLICABLE',
          reason: `Explicit Stripe apiVersion (${resolvedDates.join(', ')}) is on/after ${boundaryDate}, when ${config.changeDescription}.`,
        };
      }
      if (allNotApplicable) {
        return {
          workspacePath,
          applicability: 'NOT_APPLICABLE',
          reason: `Explicit Stripe apiVersion (${resolvedDates.join(', ')}) is pinned before ${boundaryDate}; the prior behavior still applies at that version.`,
        };
      }
      return {
        workspacePath,
        applicability: 'UNKNOWN',
        reason: `Multiple Stripe apiVersion configurations in this workspace disagree on whether they are before or after ${boundaryDate}.`,
      };
    }
  }

  return {
    workspacePath,
    applicability: 'UNKNOWN',
    reason: sdk
      ? `Stripe SDK version (resolution: ${sdk.resolutionStatus}) and explicit apiVersion are both insufficient to determine whether this change applies.`
      : 'Stripe usage was found, but no resolvable installed SDK version or explicit apiVersion configuration was found.',
  };
}

/**
 * Determines, per workspace, whether a rule's SDK/API-version boundary
 * applies -- purely from already-collected AnalysisRun evidence
 * (StripeEvidence), no new network calls. Never reduces applicability to
 * "Stripe is installed": requires an EXACT resolved SDK version at/above
 * the configured boundary, or an explicit resolvable apiVersion, to reach
 * APPLICABLE/NOT_APPLICABLE; anything less stays UNKNOWN.
 */
export function computeApplicability(
  evidence: StripeEvidence,
  config: ApplicabilityConfig,
): WorkspaceApplicability[] {
  const workspacePaths = new Set<string>();
  for (const sdk of evidence.installedSdks) workspacePaths.add(sdk.workspacePath);
  for (const clientVersion of evidence.clientVersions)
    workspacePaths.add(clientVersion.workspacePath);

  if (workspacePaths.size === 0) {
    return [
      {
        workspacePath: '',
        applicability: 'NOT_APPLICABLE',
        reason: 'No Stripe dependency evidence found in this repository.',
      },
    ];
  }

  return [...workspacePaths].map((workspacePath) =>
    computeForWorkspace(workspacePath, evidence, config),
  );
}
