export type PackageManagerName = 'npm' | 'pnpm' | 'yarn';

export type VerificationStatus =
  'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'REFUSED' | 'TIMED_OUT' | 'INFRA_ERROR';

export type FailureCategory =
  | 'CUSTOMER_REPO_FAILURE'
  | 'PATCH_FAILURE'
  | 'POLICY_REFUSAL'
  | 'SANDBOX_INFRA_FAILURE'
  | 'TIMEOUT';

export type StepKind = 'patch_apply' | 'install' | 'typecheck' | 'test';
export type StepStatus = 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'SKIPPED';

/**
 * Server-generated only, never accepted from client input -- see
 * docs/verification.md. Every field here is either derived from
 * repository evidence (package manager, Node version, script names) or
 * fixed Patchwork policy (timeouts, network, the four recognized step
 * kinds). No field allows an arbitrary command string to be supplied by
 * a caller; `commands[].args` is always constructed from a small,
 * hardcoded allowlist (see manifest.ts).
 */
export interface VerificationManifest {
  version: 1;
  workingDirectory: string;
  runtime: {
    node: { version: string; source: 'repository' | 'patchwork_default' };
    packageManager: { name: PackageManagerName; version: string | null };
  };
  patch: { patchAttemptId: string; diffSha256: string };
  installCommand: { executable: string; args: string[] };
  commands: { kind: 'typecheck' | 'test'; executable: string; args: string[]; timeoutMs: number }[];
  timeoutPolicy: { perCommandMs: number; totalMs: number };
  networkPolicy: {
    install: { mode: 'allowlist'; allowedHosts: string[] };
    verify: { mode: 'deny-all' };
  };
}

export interface StepResult {
  sequence: number;
  kind: StepKind;
  command: string;
  status: StepStatus;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdoutExcerpt: string;
  stderrExcerpt: string;
  truncated: boolean;
  startedAt: Date;
  completedAt: Date;
}

export interface VerificationOutcome {
  status: VerificationStatus;
  failureCategory: FailureCategory | null;
  failureReason: string | null;
  steps: StepResult[];
  sandboxRuntime: string | null;
}
