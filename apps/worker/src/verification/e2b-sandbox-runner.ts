import { ALL_TRAFFIC, Sandbox, TimeoutError } from 'e2b';
import type {
  NetworkAccess,
  SandboxCommand,
  SandboxCommandResult,
  SandboxCreateParams,
  SandboxFile,
  SandboxHandle,
  SandboxRunner,
} from './sandbox-runner.js';

/**
 * The one place an `e2b` SDK type is ever imported outside this file --
 * every other module in verification/ sees only the provider-agnostic
 * SandboxRunner interface. Swapping providers, or testing against
 * FakeSandboxRunner, never touches orchestration code.
 */

function toNetworkOpts(network: NetworkAccess): {
  allowInternetAccess?: boolean;
  network?: { allowOut: string[] };
} {
  if (network.mode === 'deny-all') return { allowInternetAccess: false };
  if (network.mode === 'allowlist') return { network: { allowOut: network.allowedHosts } };
  return {};
}

/** Single-quotes each argv entry, escaping embedded single quotes -- defense in depth even though every value here is always a Patchwork-controlled literal, never raw customer text (E2B's public commands.run() API only accepts a shell string, not an argv array -- see docs/verification.md's provider comparison). */
function toShellString(executable: string, args: string[]): string {
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  return [executable, ...args].map(quote).join(' ');
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

export function createE2bSandboxRunner(apiKey: string): SandboxRunner {
  const sandboxesById = new Map<string, Sandbox>();

  function requireSandbox(handle: SandboxHandle): Sandbox {
    const sandbox = sandboxesById.get(handle.id);
    if (!sandbox) throw new Error(`unknown sandbox handle: ${handle.id}`);
    return sandbox;
  }

  return {
    async create(params: SandboxCreateParams): Promise<SandboxHandle> {
      const sandbox = await Sandbox.create(params.template, {
        apiKey,
        timeoutMs: params.timeoutMs,
        envs: params.env,
        ...toNetworkOpts(params.network),
      });
      sandboxesById.set(sandbox.sandboxId, sandbox);
      return { id: sandbox.sandboxId };
    },

    async writeFiles(handle: SandboxHandle, files: SandboxFile[]): Promise<void> {
      const sandbox = requireSandbox(handle);
      if (files.length === 0) return;
      await sandbox.files.writeFiles(
        files.map((file) => ({
          path: file.path,
          data: toArrayBuffer(Buffer.from(file.contentBase64, 'base64')),
        })),
      );
    },

    async runCommand(
      handle: SandboxHandle,
      command: SandboxCommand,
    ): Promise<SandboxCommandResult> {
      const sandbox = requireSandbox(handle);
      const startedAt = Date.now();
      try {
        const result = await sandbox.commands.run(toShellString(command.executable, command.args), {
          cwd: command.cwd,
          ...(command.env ? { envs: command.env } : {}),
          timeoutMs: command.timeoutMs,
          background: false,
        });
        return {
          exitCode: result.exitCode,
          timedOut: false,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        if (error instanceof TimeoutError) {
          return {
            exitCode: null,
            timedOut: true,
            stdout: '',
            stderr: error.message,
            durationMs: Date.now() - startedAt,
          };
        }
        throw error;
      }
    },

    async updateNetwork(handle: SandboxHandle, network: NetworkAccess): Promise<void> {
      const sandbox = requireSandbox(handle);
      // The update endpoint replaces all egress rules atomically -- an
      // omitted field is cleared server-side, not left as-is. deny-all
      // sets denyOut to everything and omits allowOut (cleared); allowlist
      // sets allowOut to the exact host list and omits denyOut (cleared).
      if (network.mode === 'deny-all') {
        await sandbox.updateNetwork({ denyOut: [ALL_TRAFFIC] });
      } else if (network.mode === 'allowlist') {
        await sandbox.updateNetwork({ allowOut: network.allowedHosts });
      } else {
        await sandbox.updateNetwork({ allowOut: [ALL_TRAFFIC] });
      }
    },

    async destroy(handle: SandboxHandle): Promise<void> {
      const sandbox = sandboxesById.get(handle.id);
      sandboxesById.delete(handle.id);
      if (!sandbox) return;
      await sandbox.kill();
    },
  };
}
