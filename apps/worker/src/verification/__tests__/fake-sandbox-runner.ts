import type {
  NetworkAccess,
  SandboxCommand,
  SandboxCommandResult,
  SandboxCreateParams,
  SandboxFile,
  SandboxHandle,
  SandboxRunner,
} from '../sandbox-runner.js';

export interface FakeSandboxCall {
  kind: 'create' | 'writeFiles' | 'runCommand' | 'updateNetwork' | 'destroy';
  detail: unknown;
}

/**
 * In-memory SandboxRunner for tests -- exercises orchestration logic
 * without ever touching a real provider. Mirrors fakeGitHubClient's role
 * in apps/api/src/__tests__/fixtures.ts: only the external boundary is
 * faked, never Patchwork's own logic.
 */
export function createFakeSandboxRunner(
  overrides: Partial<{
    runCommand: (handle: SandboxHandle, command: SandboxCommand) => Promise<SandboxCommandResult>;
    create: (params: SandboxCreateParams) => Promise<SandboxHandle>;
  }> = {},
): SandboxRunner & { calls: FakeSandboxCall[]; destroyed: string[] } {
  const calls: FakeSandboxCall[] = [];
  const destroyed: string[] = [];
  let nextId = 0;

  return {
    calls,
    destroyed,
    create: async (params) => {
      calls.push({ kind: 'create', detail: params });
      if (overrides.create) return overrides.create(params);
      nextId += 1;
      return { id: `fake-sandbox-${nextId}` };
    },
    writeFiles: async (handle: SandboxHandle, files: SandboxFile[]) => {
      calls.push({ kind: 'writeFiles', detail: { handle, fileCount: files.length } });
    },
    runCommand: async (handle: SandboxHandle, command: SandboxCommand) => {
      calls.push({ kind: 'runCommand', detail: { handle, command } });
      if (overrides.runCommand) return overrides.runCommand(handle, command);
      return {
        exitCode: 0,
        timedOut: false,
        stdout: '',
        stderr: '',
        durationMs: 1,
      };
    },
    updateNetwork: async (handle: SandboxHandle, network: NetworkAccess) => {
      calls.push({ kind: 'updateNetwork', detail: { handle, network } });
    },
    destroy: async (handle: SandboxHandle) => {
      calls.push({ kind: 'destroy', detail: handle });
      destroyed.push(handle.id);
    },
  };
}
