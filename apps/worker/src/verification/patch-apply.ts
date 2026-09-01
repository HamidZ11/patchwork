import type { SandboxCommand } from './sandbox-runner.js';

/**
 * Where the persisted diff is uploaded inside the sandbox -- referenced
 * by fixed path in the patch command's argv, never embedded in the
 * command string itself (keeps the command a small, Patchwork-controlled
 * literal with zero interpolated content, diff bytes included).
 */
export const PATCH_FILE_PATH = '/tmp/patchwork.diff';

/**
 * `-p0`, not `-p1`: verified against this codebase's actual diff output
 * (remediation/diff.ts's createTwoFilesPatch(path, path, ...)), which
 * uses identical old/new paths with no `a/`/`b/` prefix -- confirmed by
 * running the real `patch` CLI against a real generated diff, not
 * assumed. `--forward` is load-bearing, not cosmetic: without it, `patch`
 * interactively prompts ("Assume -R?") when the target already looks
 * patched, and a closed/empty stdin in a non-interactive sandbox context
 * defaults that prompt to "yes" -- silently *reverse-applying* the patch
 * while reporting success. `--forward` disables that guess entirely and
 * fails closed instead (confirmed empirically: an already-applied target
 * now exits 1 with "ignoring previously applied patch", never a silent
 * reverse-apply). `--dry-run` for the CHECK stage, its absence for APPLY.
 */
function buildPatchCommand(cwd: string, dryRun: boolean, timeoutMs: number): SandboxCommand {
  return {
    executable: 'patch',
    args: dryRun
      ? ['-p0', '--forward', '--dry-run', '-i', PATCH_FILE_PATH]
      : ['-p0', '--forward', '-i', PATCH_FILE_PATH],
    cwd,
    timeoutMs,
  };
}

export function buildPatchCheckCommand(cwd: string, timeoutMs: number): SandboxCommand {
  return buildPatchCommand(cwd, true, timeoutMs);
}

export function buildPatchApplyCommand(cwd: string, timeoutMs: number): SandboxCommand {
  return buildPatchCommand(cwd, false, timeoutMs);
}
