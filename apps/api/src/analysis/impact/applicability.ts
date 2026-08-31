import type { StripeEvidence } from '../evidence/types.js';
import type { Applicability } from './types.js';

/**
 * Stripe API version at/after which `GET /v1/invoices/upcoming` (and
 * `/upcoming/lines`) are removed -- verified against
 * https://docs.stripe.com/changelog/basil/2025-03-31/invoice-preview-api-deprecations.
 */
const BASIL_DATE = '2025-03-31';

/**
 * stripe-node version at/after which `retrieveUpcoming` no longer exists
 * as a method at all -- verified directly against stripe-node source
 * (present at tag v17.7.0, absent from current master).
 */
const SDK_BOUNDARY_MAJOR = 18;

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
): WorkspaceApplicability {
  const sdk = evidence.installedSdks.find((entry) => entry.workspacePath === workspacePath);

  // SDK version is dominant when known exactly: the method is entirely
  // absent from the installed library, independent of apiVersion pinning.
  if (sdk && sdk.resolutionStatus === 'EXACT' && sdk.resolvedVersion) {
    const major = majorVersion(sdk.resolvedVersion);
    if (major !== null && major >= SDK_BOUNDARY_MAJOR) {
      return {
        workspacePath,
        applicability: 'APPLICABLE',
        reason: `stripe@${sdk.resolvedVersion} is installed; retrieveUpcoming was removed from the SDK in v${SDK_BOUNDARY_MAJOR}.0.0.`,
      };
    }
  }

  // Fall through to explicit apiVersion evidence in this workspace.
  const resolvedDates = evidence.clientVersions
    .filter((entry) => entry.workspacePath === workspacePath)
    .filter((entry) => entry.valueKind === 'LITERAL' || entry.valueKind === 'LOCAL_CONSTANT')
    .map((entry) => (entry.apiVersion ? apiVersionDatePrefix(entry.apiVersion) : null))
    .filter((date): date is string => date !== null);

  if (resolvedDates.length > 0) {
    const allApplicable = resolvedDates.every((date) => date >= BASIL_DATE);
    const allNotApplicable = resolvedDates.every((date) => date < BASIL_DATE);

    if (allApplicable) {
      return {
        workspacePath,
        applicability: 'APPLICABLE',
        reason: `Explicit Stripe apiVersion (${resolvedDates.join(', ')}) is on/after ${BASIL_DATE}.basil, when the Upcoming Invoice API was removed.`,
      };
    }
    if (allNotApplicable) {
      return {
        workspacePath,
        applicability: 'NOT_APPLICABLE',
        reason: `Explicit Stripe apiVersion (${resolvedDates.join(', ')}) is pinned before ${BASIL_DATE}.basil; the Upcoming Invoice API still exists at that version.`,
      };
    }
    return {
      workspacePath,
      applicability: 'UNKNOWN',
      reason:
        'Multiple Stripe apiVersion configurations in this workspace disagree on whether they are before or after 2025-03-31.basil.',
    };
  }

  return {
    workspacePath,
    applicability: 'UNKNOWN',
    reason: sdk
      ? `Stripe SDK version (resolution: ${sdk.resolutionStatus}) and explicit apiVersion are both insufficient to determine whether the Upcoming Invoice API removal applies.`
      : 'Stripe usage was found, but no resolvable installed SDK version or explicit apiVersion configuration was found.',
  };
}

/**
 * Determines, per workspace, whether the Stripe Upcoming Invoice API
 * removal applies -- purely from already-collected AnalysisRun evidence
 * (StripeEvidence), no new network calls. Never reduces applicability to
 * "Stripe is installed": requires an EXACT resolved SDK version >= 18, or
 * an explicit resolvable apiVersion, to reach APPLICABLE/NOT_APPLICABLE;
 * anything less stays UNKNOWN.
 */
export function computeApplicability(evidence: StripeEvidence): WorkspaceApplicability[] {
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

  return [...workspacePaths].map((workspacePath) => computeForWorkspace(workspacePath, evidence));
}
