import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { withExtractedArchive } from './archive.js';
import type { StripeEvidence } from './evidence/types.js';
import { assessRuleImpact } from './impact/assess.js';
import { IMPACT_RULES } from './impact/registry.js';
import type { ImpactAssessmentResult, RuleDefinition } from './impact/types.js';

export interface RuleAssessment {
  rule: RuleDefinition;
  result: ImpactAssessmentResult;
}

/**
 * Downloads the exact-SHA repository archive for a RepositorySnapshot
 * (fresh -- the extraction from the original evidence-collection request
 * was already deleted, no permanent source storage) ONCE, and evaluates
 * every currently-known rule (see impact/registry.ts) against it, using
 * evidence already collected for this AnalysisRun for applicability.
 * Orchestration only, mirrors analysis/evidence.ts's structure.
 */
export async function assessAllRulesImpact(
  params: { owner: string; name: string; commitSha: string; githubInstallationId: number },
  evidence: StripeEvidence,
  deps: { client: GitHubClient; appAuth: GitHubAppAuth },
): Promise<RuleAssessment[]> {
  const downloadDir = await mkdtemp(join(tmpdir(), 'patchwork-download-'));
  const archivePath = join(downloadDir, 'archive.tar.gz');

  try {
    const installationToken = await deps.appAuth.getInstallationToken(params.githubInstallationId);
    await deps.client.downloadRepositoryArchive(
      params.owner,
      params.name,
      params.commitSha,
      installationToken,
      archivePath,
    );

    return await withExtractedArchive(archivePath, (extraction) =>
      IMPACT_RULES.map((rule) => ({
        rule,
        result: assessRuleImpact(
          evidence,
          extraction.files,
          { sourceFilesTruncated: extraction.truncated },
          rule,
        ),
      })),
    );
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
}
