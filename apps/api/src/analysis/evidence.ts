import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { withExtractedArchive, type ExtractedFile } from './archive.js';
import { scanForClientVersionEvidence } from './evidence/api-version.js';
import { resolveStripeVersions } from './evidence/lockfiles.js';
import { discoverManifests } from './evidence/manifests.js';
import { STRIPE_EVIDENCE_SCHEMA_VERSION, type StripeEvidence } from './evidence/types.js';

/**
 * Composes deterministic StripeEvidence from an already-extracted file set
 * -- pure, no I/O. Extracted as its own function so the benchmark harness
 * can produce real StripeEvidence from hand-written fixtures without going
 * through archive download/extraction.
 */
export function buildStripeEvidenceFromFiles(
  files: ExtractedFile[],
  truncated: boolean,
): StripeEvidence {
  const manifestResult = discoverManifests(files);
  const lockfileResult = resolveStripeVersions(files, manifestResult.stripeDeclarations);
  const apiVersionResult = scanForClientVersionEvidence(files);

  return {
    schemaVersion: STRIPE_EVIDENCE_SCHEMA_VERSION,
    installedSdks: lockfileResult.installedSdks,
    clientVersions: apiVersionResult.clientVersions,
    accountVersion: {
      status: 'UNKNOWN',
      reason: 'requires a live Stripe API call, not implemented',
    },
    webhookVersion: {
      status: 'OUT_OF_SCOPE',
      reason: 'webhook configuration analysis not implemented',
    },
    coverage: {
      archiveAcquired: true,
      manifestsDiscovered: manifestResult.manifestsDiscovered,
      workspaceConfigDiscovered: manifestResult.workspaceConfigDiscovered,
      lockfilesDiscovered: lockfileResult.lockfilesDiscovered,
      lockfilesParsed: lockfileResult.lockfilesParsed,
      lockfilesUnsupported: lockfileResult.lockfilesUnsupported,
      sourceFilesScanned: apiVersionResult.sourceFilesScanned,
      sourceFilesTruncated: truncated,
      parseFailures: [
        ...manifestResult.parseFailures,
        ...lockfileResult.parseFailures,
        ...apiVersionResult.parseFailures,
      ],
    },
  };
}

/**
 * Downloads the exact-SHA repository archive and collects deterministic
 * Stripe/TypeScript applicability evidence from it -- never a decision
 * about whether any change affects the repository. Orchestration only:
 * github/client.ts owns the HTTP boundary, analysis/archive.ts owns
 * extraction/cleanup, analysis/evidence/* own pure evidence extraction.
 * Guaranteed cleanup of the downloaded archive regardless of outcome.
 */
export async function collectStripeEvidence(
  params: { owner: string; name: string; commitSha: string; githubInstallationId: number },
  deps: { client: GitHubClient; appAuth: GitHubAppAuth },
): Promise<StripeEvidence> {
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
      buildStripeEvidenceFromFiles(extraction.files, extraction.truncated),
    );
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
}
