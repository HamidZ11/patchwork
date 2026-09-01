import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VerificationExtractedFile } from '@patchwork/archive';
import { withExtractedArchiveForVerification } from '@patchwork/archive';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { deriveManifest } from './manifest.js';
import { capStepOutput } from './output.js';
import { buildPatchApplyCommand, buildPatchCheckCommand, PATCH_FILE_PATH } from './patch-apply.js';
import type { PatchAttemptForVerification } from './persistence.js';
import { PATCHWORK_DEFAULT_NODE_VERSION, SANDBOX_TEMPLATE, TIMEOUT_POLICY } from './policy.js';
import type { SandboxHandle, SandboxRunner } from './sandbox-runner.js';
import type { StepKind, StepResult, VerificationManifest, VerificationOutcome } from './types.js';

const SANDBOX_WORKDIR = '/home/user/repo';

export interface RunVerificationDeps {
  sandboxRunner: SandboxRunner;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
}

export interface RunVerificationResult {
  outcome: VerificationOutcome;
  manifest: VerificationManifest | null;
}

function refused(reason: string): RunVerificationResult {
  return {
    outcome: {
      status: 'REFUSED',
      failureCategory: 'POLICY_REFUSAL',
      failureReason: reason,
      steps: [],
      sandboxRuntime: null,
    },
    manifest: null,
  };
}

function infraError(reason: string): RunVerificationResult {
  return {
    outcome: {
      status: 'INFRA_ERROR',
      failureCategory: 'SANDBOX_INFRA_FAILURE',
      failureReason: reason,
      steps: [],
      sandboxRuntime: null,
    },
    manifest: null,
  };
}

/**
 * Runs one VerificationRun's full pipeline: acquire the exact-SHA
 * archive (trusted, unchanged GitHub download/extraction), derive a
 * server-only VerificationManifest, create an isolated sandbox, apply
 * the persisted patch, install dependencies, and run the recognized
 * verification commands -- see docs/verification.md for the full
 * design. The sandbox never receives a GitHub token, DB credentials, or
 * any Patchwork secret; only extracted repository bytes, the diff text,
 * and CI=1/NODE_ENV=test.
 *
 * Stop-on-failure policy (approved): patch-apply failure or install
 * failure stops immediately (nothing downstream is meaningful); once
 * install passes, typecheck and test both always run regardless of each
 * other's outcome, so a failed typecheck doesn't hide a test result.
 * Total-timeout/sandbox-infra/policy failures terminate immediately
 * regardless of this policy.
 */
export async function runVerification(
  patchAttempt: PatchAttemptForVerification,
  deps: RunVerificationDeps,
): Promise<RunVerificationResult> {
  if (patchAttempt.status !== 'GENERATED') {
    return refused(
      `patch attempt status is ${patchAttempt.status}, not GENERATED -- nothing to verify`,
    );
  }
  if (!patchAttempt.diff || patchAttempt.changedFiles.length === 0) {
    return refused('patch attempt has no diff to apply');
  }

  const runStartedAt = Date.now();
  const totalDeadline = runStartedAt + TIMEOUT_POLICY.totalMs;
  const diffSha256 = createHash('sha256').update(patchAttempt.diff).digest('hex');

  const downloadDir = await mkdtemp(join(tmpdir(), 'patchwork-verify-download-'));
  const archivePath = join(downloadDir, 'archive.tar.gz');

  let extractedFiles: VerificationExtractedFile[];
  try {
    const installationToken = await deps.githubAppAuth.getInstallationToken(
      patchAttempt.githubInstallationId,
    );
    await deps.githubClient.downloadRepositoryArchive(
      patchAttempt.repositoryOwner,
      patchAttempt.repositoryName,
      patchAttempt.commitSha,
      installationToken,
      archivePath,
    );

    const extraction = await withExtractedArchiveForVerification(archivePath, (result) => result);
    if (extraction.truncated) {
      return infraError(
        'repository snapshot extraction was truncated -- refusing to verify against an incomplete snapshot',
      );
    }
    extractedFiles = extraction.files;
  } catch (error) {
    return infraError(
      error instanceof Error
        ? `could not acquire the repository archive: ${error.message}`
        : 'could not acquire the repository archive',
    );
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }

  const manifestResult = deriveManifest({
    files: extractedFiles,
    patchAttemptId: patchAttempt.id,
    diffSha256,
    workingDirectory: '',
  });
  if (manifestResult.kind === 'refused') return refused(manifestResult.reason);
  const manifest = manifestResult.manifest;

  const outcome = await runInSandbox(
    manifest,
    patchAttempt.diff,
    extractedFiles,
    deps.sandboxRunner,
    totalDeadline,
  );
  return { outcome, manifest };
}

async function runInSandbox(
  manifest: VerificationManifest,
  diffText: string,
  files: VerificationExtractedFile[],
  sandboxRunner: SandboxRunner,
  totalDeadline: number,
): Promise<VerificationOutcome> {
  let handle: SandboxHandle | null = null;
  const steps: StepResult[] = [];
  let bytesUsed = 0;
  let sequence = 0;

  const remainingMs = () => Math.max(0, totalDeadline - Date.now());

  function finalize(
    finalSteps: StepResult[],
    failureCategory: VerificationOutcome['failureCategory'],
    failureReason: string | null,
  ): VerificationOutcome {
    const status: VerificationOutcome['status'] =
      failureCategory === null
        ? 'PASSED'
        : failureCategory === 'TIMEOUT'
          ? 'TIMED_OUT'
          : failureCategory === 'SANDBOX_INFRA_FAILURE'
            ? 'INFRA_ERROR'
            : failureCategory === 'POLICY_REFUSAL'
              ? 'REFUSED'
              : 'FAILED';
    return {
      status,
      failureCategory,
      failureReason,
      steps: finalSteps,
      sandboxRuntime:
        manifest.runtime.node.source === 'patchwork_default'
          ? `${SANDBOX_TEMPLATE}:node${PATCHWORK_DEFAULT_NODE_VERSION}`
          : SANDBOX_TEMPLATE,
    };
  }

  async function runStep(
    kind: StepKind,
    command: { executable: string; args: string[]; timeoutMs: number },
  ): Promise<StepResult> {
    sequence += 1;
    const perStepTimeout = Math.min(command.timeoutMs, remainingMs());
    const startedAt = new Date();

    if (perStepTimeout <= 0 || !handle) {
      const completedAt = new Date();
      return {
        sequence,
        kind,
        command: `${command.executable} ${command.args.join(' ')}`,
        status: 'SKIPPED',
        exitCode: null,
        timedOut: false,
        durationMs: 0,
        stdoutExcerpt: '',
        stderrExcerpt: '',
        truncated: false,
        startedAt,
        completedAt,
      };
    }

    const result = await sandboxRunner.runCommand(handle, {
      executable: command.executable,
      args: command.args,
      cwd: SANDBOX_WORKDIR,
      timeoutMs: perStepTimeout,
      env: { CI: '1', NODE_ENV: 'test' },
    });
    const completedAt = new Date();
    const capped = capStepOutput(result.stdout, result.stderr, bytesUsed);
    bytesUsed = capped.bytesUsed;

    return {
      sequence,
      kind,
      command: `${command.executable} ${command.args.join(' ')}`,
      status: result.timedOut ? 'TIMED_OUT' : result.exitCode === 0 ? 'PASSED' : 'FAILED',
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      stdoutExcerpt: capped.stdout.text,
      stderrExcerpt: capped.stderr.text,
      truncated: capped.stdout.truncated || capped.stderr.truncated,
      startedAt,
      completedAt,
    };
  }

  try {
    try {
      handle = await sandboxRunner.create({
        template: SANDBOX_TEMPLATE,
        timeoutMs: TIMEOUT_POLICY.sandboxLifetimeMs,
        network: manifest.networkPolicy.install,
        env: { CI: '1', NODE_ENV: 'test' },
      });
    } catch (error) {
      return finalize(
        steps,
        'SANDBOX_INFRA_FAILURE',
        error instanceof Error
          ? `sandbox creation failed: ${error.message}`
          : 'sandbox creation failed',
      );
    }

    try {
      await sandboxRunner.writeFiles(
        handle,
        files.map((f) => ({
          path: `${SANDBOX_WORKDIR}/${f.path}`,
          contentBase64: f.contentBase64,
        })),
      );
      await sandboxRunner.writeFiles(handle, [
        { path: PATCH_FILE_PATH, contentBase64: Buffer.from(diffText, 'utf-8').toString('base64') },
      ]);
    } catch (error) {
      return finalize(
        steps,
        'SANDBOX_INFRA_FAILURE',
        error instanceof Error
          ? `uploading files to the sandbox failed: ${error.message}`
          : 'uploading files to the sandbox failed',
      );
    }

    const checkCmd = buildPatchCheckCommand(SANDBOX_WORKDIR, manifest.timeoutPolicy.perCommandMs);
    const checkStep = await runStep('patch_apply', checkCmd);
    steps.push(checkStep);
    if (checkStep.status !== 'PASSED') {
      return finalize(
        steps,
        checkStep.timedOut ? 'TIMEOUT' : 'PATCH_FAILURE',
        'candidate patch did not apply cleanly to the exact repository snapshot',
      );
    }

    const applyCmd = buildPatchApplyCommand(SANDBOX_WORKDIR, manifest.timeoutPolicy.perCommandMs);
    const applyStep = await runStep('patch_apply', applyCmd);
    steps.push(applyStep);
    if (applyStep.status !== 'PASSED') {
      return finalize(
        steps,
        applyStep.timedOut ? 'TIMEOUT' : 'PATCH_FAILURE',
        'candidate patch failed to apply',
      );
    }

    const installStep = await runStep('install', {
      ...manifest.installCommand,
      timeoutMs: manifest.timeoutPolicy.perCommandMs,
    });
    steps.push(installStep);
    if (installStep.status !== 'PASSED') {
      return finalize(
        steps,
        installStep.timedOut ? 'TIMEOUT' : 'CUSTOMER_REPO_FAILURE',
        'dependency installation failed',
      );
    }

    try {
      await sandboxRunner.updateNetwork(handle, manifest.networkPolicy.verify);
    } catch (error) {
      return finalize(
        steps,
        'SANDBOX_INFRA_FAILURE',
        error instanceof Error
          ? `failed to lock down network before verification commands: ${error.message}`
          : 'failed to lock down network before verification commands',
      );
    }

    // Both run regardless of each other's outcome -- a failed typecheck
    // must not hide the test result, and vice versa (approved policy).
    for (const command of manifest.commands) {
      const step = await runStep(command.kind, command);
      steps.push(step);
    }

    const anyTimedOut = steps.some((s) => s.timedOut);
    const anyFailed = steps.some((s) => s.status === 'FAILED');
    if (anyTimedOut)
      return finalize(steps, 'TIMEOUT', 'a verification command exceeded its time budget');
    if (anyFailed)
      return finalize(steps, 'CUSTOMER_REPO_FAILURE', 'one or more verification commands failed');

    return finalize(steps, null, null);
  } finally {
    if (handle) {
      try {
        await sandboxRunner.destroy(handle);
      } catch {
        // Cleanup failure must never mask the run's actual result -- the
        // sandbox's own timeoutMs is the backstop if destroy itself fails.
      }
    }
  }
}
