import type { ExtractedFile } from '../archive.js';
import type { StripeEvidence } from '../evidence/types.js';
import { computeApplicability } from './applicability.js';
import { scanForRetrieveUpcomingUsage } from './predicate.js';
import type { ImpactAssessmentResult, ImpactStatus, WorkspaceCoverage } from './types.js';

/**
 * Combines applicability (§ applicability.ts, from already-collected
 * evidence) and the semantic predicate (§ predicate.ts, real TypeScript
 * analysis) into one tri-state verdict per workspace, then aggregates to
 * one assessment for the whole AnalysisRun.
 *
 * Precedence when aggregating across workspaces: AFFECTED > UNCERTAIN >
 * NOT_AFFECTED. Positive proof in one workspace is never suppressed by
 * uncertainty elsewhere -- the safety invariant this guards is "failure
 * to prove AFFECTED is not evidence of NOT_AFFECTED", not "uncertainty
 * anywhere poisons a proven finding". Per-workspace:
 *   - NOT_APPLICABLE            -> NOT_AFFECTED (version-based negative proof)
 *   - UNKNOWN applicability     -> UNCERTAIN (even if the predicate matched --
 *                                  insufficient applicability evidence caps
 *                                  the result, never overridden by a match)
 *   - APPLICABLE + match(es)    -> AFFECTED
 *   - APPLICABLE + ambiguous/failed-to-load reference(s) -> UNCERTAIN
 *   - APPLICABLE + zero matches, full coverage -> NOT_AFFECTED
 */
export function assessRetrieveUpcomingImpact(
  evidence: StripeEvidence,
  extractedFiles: ExtractedFile[],
  archiveCoverage: { sourceFilesTruncated: boolean },
): ImpactAssessmentResult {
  const applicabilityByWorkspace = computeApplicability(evidence);
  const predicateByWorkspace = scanForRetrieveUpcomingUsage(extractedFiles);

  const workspacePaths = new Set<string>([
    ...applicabilityByWorkspace.map((entry) => entry.workspacePath),
    ...predicateByWorkspace.keys(),
  ]);

  const workspaces: WorkspaceCoverage[] = [];
  let overall: ImpactStatus = 'NOT_AFFECTED';
  const reasons: string[] = [];

  for (const workspacePath of workspacePaths) {
    const applicability = applicabilityByWorkspace.find(
      (entry) => entry.workspacePath === workspacePath,
    ) ?? {
      workspacePath,
      applicability: 'UNKNOWN' as const,
      reason: 'No applicability evidence available for this workspace.',
    };
    const predicate = predicateByWorkspace.get(workspacePath) ?? {
      matches: [],
      ambiguousReferences: [],
      filesFailedToLoad: [],
      sourceFilesScanned: 0,
    };

    let workspaceStatus: ImpactStatus;
    if (applicability.applicability === 'NOT_APPLICABLE') {
      workspaceStatus = 'NOT_AFFECTED';
    } else if (applicability.applicability === 'UNKNOWN') {
      workspaceStatus = 'UNCERTAIN';
    } else if (predicate.matches.length > 0) {
      workspaceStatus = 'AFFECTED';
    } else if (predicate.ambiguousReferences.length > 0 || predicate.filesFailedToLoad.length > 0) {
      workspaceStatus = 'UNCERTAIN';
    } else {
      workspaceStatus = 'NOT_AFFECTED';
    }

    workspaces.push({
      workspacePath,
      applicability: applicability.applicability,
      applicabilityReason: applicability.reason,
      sourceFilesScanned: predicate.sourceFilesScanned,
      filesFailedToLoad: predicate.filesFailedToLoad,
      ambiguousReferences: predicate.ambiguousReferences,
      matches: predicate.matches,
    });

    const label = workspacePath || '.';
    if (workspaceStatus === 'AFFECTED') {
      overall = 'AFFECTED';
      reasons.push(
        `[${label}] AFFECTED: ${predicate.matches.length} confirmed usage(s) of stripe.invoices.retrieveUpcoming found (${applicability.reason})`,
      );
    } else if (workspaceStatus === 'UNCERTAIN' && overall !== 'AFFECTED') {
      overall = 'UNCERTAIN';
      reasons.push(
        `[${label}] UNCERTAIN: ${
          applicability.applicability === 'UNKNOWN'
            ? applicability.reason
            : 'analysis coverage was incomplete (unresolved reference or failed-to-load file)'
        }`,
      );
    } else if (workspaceStatus === 'NOT_AFFECTED') {
      reasons.push(
        `[${label}] NOT_AFFECTED: ${
          applicability.applicability === 'NOT_APPLICABLE'
            ? applicability.reason
            : 'no matching Stripe usage found, full coverage'
        }`,
      );
    }
  }

  if (archiveCoverage.sourceFilesTruncated && overall !== 'AFFECTED') {
    overall = 'UNCERTAIN';
    reasons.push(
      'Archive extraction was truncated (too many files); analysis coverage is incomplete.',
    );
  }

  return {
    status: overall,
    reason: reasons.join(' '),
    coverage: {
      schemaVersion: 1,
      archiveAcquired: true,
      sourceFilesTruncated: archiveCoverage.sourceFilesTruncated,
      workspaces,
    },
    findings: workspaces.flatMap((workspace) => workspace.matches),
  };
}
