/**
 * Provider-agnostic sandbox boundary -- mirrors GitHubClient's existing
 * role as the one place a real external HTTP/SDK boundary is isolated
 * (apps/api/src/routes/*.ts never see @octokit directly; nothing outside
 * verification/e2b-sandbox-runner.ts sees an `e2b` SDK type). Swapping
 * providers, or testing against a fake, never touches orchestration code.
 */

export type NetworkAccess =
  { mode: 'allowlist'; allowedHosts: string[] } | { mode: 'deny-all' } | { mode: 'allow-all' };

export interface SandboxCreateParams {
  /** Provider template/image identity -- e.g. an E2B template name. Never customer-influenced. */
  template: string;
  /** Hard sandbox-lifetime ceiling, enforced by the provider itself as a backstop independent of our own cleanup. */
  timeoutMs: number;
  network: NetworkAccess;
  /** Minimal, fixed, non-secret env only -- see docs/security.md. Never a customer or Patchwork secret. */
  env: Record<string, string>;
}

export interface SandboxFile {
  path: string;
  /** Always base64 -- binary-safe, never assumed to be UTF-8 text. */
  contentBase64: string;
}

export interface SandboxCommand {
  /** A Patchwork-controlled literal executable, e.g. 'npm' -- never customer-controlled. */
  executable: string;
  /** Explicit argv, e.g. ['run', 'typecheck'] -- never a raw shell string built from untrusted input. */
  args: string[];
  cwd: string;
  timeoutMs: number;
  /** Per-command env override; still only ever Patchwork-controlled non-secret values. */
  env?: Record<string, string>;
}

export interface SandboxCommandResult {
  exitCode: number | null;
  timedOut: boolean;
  /** Unbounded as returned by the provider -- callers MUST cap before persisting (see output.ts). Never rely on the provider to bound this. */
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SandboxHandle {
  readonly id: string;
}

export interface SandboxRunner {
  create(params: SandboxCreateParams): Promise<SandboxHandle>;
  writeFiles(handle: SandboxHandle, files: SandboxFile[]): Promise<void>;
  runCommand(handle: SandboxHandle, command: SandboxCommand): Promise<SandboxCommandResult>;
  updateNetwork(handle: SandboxHandle, network: NetworkAccess): Promise<void>;
  destroy(handle: SandboxHandle): Promise<void>;
}
