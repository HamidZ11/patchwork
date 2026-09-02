import type { PublishContext } from './types.js';

const MAX_SLUG_LENGTH = 60;
const SHORT_ID_LENGTH = 8;

/**
 * Deterministic, collision-resistant, safe-Git-ref-characters branch
 * naming: `patchwork/<transformation-kind-slug>/<patch-attempt-short-id>`.
 * Built entirely from server-controlled values (never a caller-supplied
 * string) -- the transformationKind slug is human-readable evidence of
 * *what* fix this is, and the patch-attempt-id suffix makes collisions
 * between legitimate Patchwork branches a UUID collision, i.e.
 * structurally impossible. A 409 on branch creation therefore always
 * means either a stray non-Patchwork branch with this exact name, or a
 * resume of this exact prior attempt -- never two different legitimate
 * Patchwork branches colliding.
 */
export function deriveBranchName(transformationKind: string, patchAttemptId: string): string {
  const slug = sanitizeSlug(transformationKind);
  const shortId = patchAttemptId.replace(/-/g, '').slice(0, SHORT_ID_LENGTH);
  return `patchwork/${slug}/${shortId}`;
}

function sanitizeSlug(input: string): string {
  const sanitized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const bounded = sanitized.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
  return bounded.length > 0 ? bounded : 'fix';
}

export function derivePrTitle(context: PublishContext): string {
  return `Migrate ${context.providerChangeTitle}`;
}

function scriptEvidenceLine(step: {
  kind: string;
  status: string;
  exitCode: number | null;
}): string {
  const mark = step.status === 'PASSED' ? '✓' : '✗';
  const exitText = step.exitCode === null ? `status ${step.status}` : `exited ${step.exitCode}`;
  return `${mark} Repository script \`${step.kind}\` ${exitText}.`;
}

/**
 * Every claim here is derived strictly from what actually ran/passed --
 * never a blanket "all tests passed." Postcondition and verification-step
 * evidence both come directly from persisted PatchAttempt/VerificationRun
 * rows, never restated from memory/assumption. No raw sandbox logs are
 * ever included -- a future Patchwork evidence page is the place for
 * full output, not the PR body.
 */
export function derivePrBody(
  context: PublishContext,
  params: { branchName: string; commitSha: string },
): string {
  const findingsList = context.changedFiles.map((file) => `- ${file}`).join('\n');

  const staticChecks = context.postconditionChecks
    .map((check) => `${check.passed ? '✓' : '✗'} ${check.name}`)
    .join('\n');

  const runtimeSteps = context.verificationSteps
    .filter((step) => step.kind !== 'patch_apply')
    .map(scriptEvidenceLine)
    .join('\n');

  const nodeLabel =
    context.nodeVersion === null
      ? 'unknown'
      : context.nodeVersionSource === 'patchwork_default'
        ? `${context.nodeVersion} (Patchwork default)`
        : context.nodeVersion;

  return `## Why

${context.providerChangeTitle}

Patchwork found affected usage in:
${findingsList}

## Change

Deterministic transformation \`${context.transformationKind}\`, applied against the exact analysed commit (\`${context.analysedCommitSha.slice(0, 7)}\`).

## Verification

Static postconditions:
${staticChecks}

Sandbox verification (commit \`${params.commitSha.slice(0, 7)}\`, Node ${nodeLabel}, ${context.packageManager ?? 'unknown package manager'}):
${runtimeSteps}

## Source

${context.providerChangeSourceUrl}

## Safety

This PR was generated from Patchwork's deterministic remediation rule for \`${context.providerChangeExternalId}\` and verified in an isolated sandbox before publishing. No code was auto-merged or deployed -- please review like any other PR.

---
Patchwork-Change: ${context.providerChangeExternalId}
Patchwork-Patch: ${context.patchAttemptId}
`;
}

export function deriveCommitMessage(context: PublishContext): string {
  return `fix(stripe): migrate ${context.transformationKind.replace(/_/g, ' ')}

Patchwork-Change: ${context.providerChangeExternalId}
Patchwork-Patch: ${context.patchAttemptId}
`;
}
