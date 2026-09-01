import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtractedFile } from '../analysis/archive.js';
import { withExtractedArchive } from '../analysis/archive.js';
import { TSCONFIG_BASENAME_PATTERN } from '../analysis/impact/predicates/engine.js';
import type { Finding } from '../analysis/impact/types.js';
import type { GitHubAppAuth } from '../github/auth.js';
import type { GitHubClient } from '../github/client.js';
import { buildUnifiedDiff } from './diff.js';
import { findRecipeForPredicateKind } from './registry.js';
import type { GeneratePatchAttemptResult, PostconditionCheck } from './types.js';

export interface AssessmentForRemediation {
  status: string;
  predicateKind: string;
  repositoryOwner: string;
  repositoryName: string;
  githubInstallationId: number;
  commitSha: string;
  findings: Finding[];
}

const MAX_DIFF_CHARS = 20_000;

const FORBIDDEN_PATH_PATTERNS: RegExp[] = [
  /(^|\/)package\.json$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)\.github\//,
];

function isForbiddenPath(path: string): boolean {
  return FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function groupByFile(findings: Finding[]): Map<string, Finding[]> {
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = byFile.get(finding.sourceFile) ?? [];
    list.push(finding);
    byFile.set(finding.sourceFile, list);
  }
  return byFile;
}

/**
 * Generates and independently checks a deterministic candidate patch for
 * one AFFECTED, supported ImpactAssessment. Mirrors
 * analysis/impact.ts's assessAllRulesImpact exactly for archive
 * acquisition: fresh installation token (never persisted/logged), exact-
 * SHA archive download, extraction to a temp dir cleaned up in `finally`.
 * Never mutates the customer's repository, never installs dependencies,
 * never executes anything from it -- reading/parsing/rewriting text only.
 *
 * Whole-attempt refusal, not best-effort: if ANY finding for this
 * assessment can't be proven safe (wrong shape, stale span, write
 * position, ...), nothing is rewritten and the attempt is REFUSED with
 * the specific reason -- never a partial patch covering only the "easy"
 * findings.
 */
export async function generatePatchAttempt(
  assessment: AssessmentForRemediation,
  deps: { client: GitHubClient; appAuth: GitHubAppAuth },
): Promise<GeneratePatchAttemptResult> {
  if (assessment.status !== 'AFFECTED') {
    return {
      status: 'REFUSED',
      refusalReason: `assessment status is ${assessment.status}, not AFFECTED -- Patchwork never remediates UNCERTAIN or NOT_AFFECTED assessments`,
      changedFiles: [],
    };
  }

  const recipe = findRecipeForPredicateKind(assessment.predicateKind);
  if (!recipe) {
    return {
      status: 'REFUSED',
      refusalReason: `no supported deterministic remediation for rule "${assessment.predicateKind}"`,
      changedFiles: [],
    };
  }

  if (assessment.findings.length === 0) {
    return {
      status: 'REFUSED',
      refusalReason: 'assessment has no findings to remediate',
      changedFiles: [],
    };
  }

  const byFile = groupByFile(assessment.findings);
  for (const filePath of byFile.keys()) {
    if (isForbiddenPath(filePath)) {
      return {
        status: 'REFUSED',
        refusalReason: `${filePath} is a forbidden path for automatic remediation`,
        changedFiles: [],
      };
    }
  }

  const downloadDir = await mkdtemp(join(tmpdir(), 'patchwork-remediation-'));
  const archivePath = join(downloadDir, 'archive.tar.gz');

  try {
    const installationToken = await deps.appAuth.getInstallationToken(
      assessment.githubInstallationId,
    );
    await deps.client.downloadRepositoryArchive(
      assessment.repositoryOwner,
      assessment.repositoryName,
      assessment.commitSha,
      installationToken,
      archivePath,
    );

    return await withExtractedArchive(archivePath, (extraction) => {
      const tsconfigFiles = extraction.files.filter((file) =>
        TSCONFIG_BASENAME_PATTERN.test(file.path.split('/').pop() ?? ''),
      );
      const fileByPath = new Map<string, ExtractedFile>(extraction.files.map((f) => [f.path, f]));

      const rewrites: { path: string; before: string; after: string }[] = [];

      for (const [filePath, findingsInFile] of byFile) {
        const extracted = fileByPath.get(filePath);
        if (!extracted) {
          return {
            status: 'REFUSED',
            refusalReason: `${filePath} was not found in the analysed snapshot (stale finding)`,
            changedFiles: [],
          };
        }

        const result = recipe.transformFile(extracted.content, findingsInFile, tsconfigFiles);
        if (result.kind === 'refused') {
          return { status: 'REFUSED', refusalReason: result.reason, changedFiles: [] };
        }
        rewrites.push({ path: filePath, before: extracted.content, after: result.newText });
      }

      const postconditionResult: PostconditionCheck[] = rewrites.flatMap((rewrite) =>
        recipe.checkPostconditions(rewrite.before, rewrite.after, rewrite.path, tsconfigFiles),
      );
      const failedChecks = postconditionResult.filter((check) => !check.passed);
      if (failedChecks.length > 0) {
        return {
          status: 'FAILED',
          failureReason: `postcondition check failed: ${failedChecks.map((c) => `${c.name} (${c.detail})`).join('; ')}`,
          changedFiles: rewrites.map((r) => r.path),
          postconditionResult,
        };
      }

      const changedFiles = rewrites.map((r) => r.path);
      for (const path of changedFiles) {
        if (isForbiddenPath(path)) {
          return {
            status: 'REFUSED',
            refusalReason: `${path} is a forbidden path -- refusing even though the transformation itself reported success`,
            changedFiles: [],
          };
        }
      }

      const diff = buildUnifiedDiff(rewrites);
      if (diff.length > MAX_DIFF_CHARS) {
        return {
          status: 'REFUSED',
          refusalReason: `candidate diff (${diff.length} chars) exceeds the ${MAX_DIFF_CHARS}-char bound for automatic remediation`,
          changedFiles: [],
        };
      }

      return { status: 'GENERATED', changedFiles, diff, postconditionResult };
    });
  } catch (error) {
    return {
      status: 'FAILED',
      failureReason:
        error instanceof Error
          ? `could not acquire or process the repository archive: ${error.message}`
          : 'could not acquire or process the repository archive',
      changedFiles: [],
    };
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
}
