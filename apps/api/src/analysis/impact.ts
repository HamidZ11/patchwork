import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitHubAppAuth } from '../github/auth.js';
import type { GitHubClient } from '../github/client.js';
import { withExtractedArchive } from './archive.js';
import type { StripeEvidence } from './evidence/types.js';
import { assessRetrieveUpcomingImpact } from './impact/assess.js';
import type { ImpactAssessmentResult } from './impact/types.js';

/**
 * Downloads the exact-SHA repository archive for a RepositorySnapshot
 * (fresh -- the extraction from the original evidence-collection request
 * was already deleted, no permanent source storage) and evaluates the one
 * encoded Stripe ProviderChange against it, using evidence already
 * collected for this AnalysisRun for applicability. Orchestration only,
 * mirrors analysis/evidence.ts's structure.
 */
export async function assessStripeBasilInvoicePreviewImpact(
  params: { owner: string; name: string; commitSha: string; githubInstallationId: number },
  evidence: StripeEvidence,
  deps: { client: GitHubClient; appAuth: GitHubAppAuth },
): Promise<ImpactAssessmentResult> {
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
      assessRetrieveUpcomingImpact(evidence, extraction.files, {
        sourceFilesTruncated: extraction.truncated,
      }),
    );
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
}
