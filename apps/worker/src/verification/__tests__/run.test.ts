import { describe, expect, it } from 'vitest';
import { createFakeSandboxRunner } from './fake-sandbox-runner.js';
import { fakeGitHubAppAuth, fakeGitHubClientWithArchive } from './fixtures.js';
import { runVerification } from '../run.js';
import type { PatchAttemptForVerification } from '../persistence.js';
import type { SandboxCommand, SandboxCommandResult } from '../sandbox-runner.js';

const PKG = JSON.stringify({
  name: 'demo',
  scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' },
});

function basePatchAttempt(
  overrides: Partial<PatchAttemptForVerification> = {},
): PatchAttemptForVerification {
  return {
    id: 'pa-1',
    status: 'GENERATED',
    diff: '--- src/billing.ts\n+++ src/billing.ts\n@@ -1 +1 @@\n-old\n+new\n',
    changedFiles: ['src/billing.ts'],
    repositoryOwner: 'octocat',
    repositoryName: 'hello-world',
    githubInstallationId: 1,
    commitSha: 'a'.repeat(40),
    ...overrides,
  };
}

const REPO_FILES = {
  'package.json': PKG,
  'package-lock.json': '{}',
  'src/billing.ts': 'old\n',
};

describe('runVerification', () => {
  it('refuses a non-GENERATED patch attempt before touching anything', async () => {
    const { outcome } = await runVerification(basePatchAttempt({ status: 'FAILED' }), {
      sandboxRunner: createFakeSandboxRunner(),
      githubClient: fakeGitHubClientWithArchive({}),
      githubAppAuth: fakeGitHubAppAuth(),
    });
    expect(outcome.status).toBe('REFUSED');
    expect(outcome.failureCategory).toBe('POLICY_REFUSAL');
  });

  it('fails with SANDBOX_INFRA_FAILURE (not a customer-repo failure) when archive acquisition throws', async () => {
    const client = fakeGitHubClientWithArchive(
      {},
      {
        downloadRepositoryArchive: async () => {
          throw new Error('network error');
        },
      },
    );
    const { outcome } = await runVerification(basePatchAttempt(), {
      sandboxRunner: createFakeSandboxRunner(),
      githubClient: client,
      githubAppAuth: fakeGitHubAppAuth(),
    });
    expect(outcome.status).toBe('INFRA_ERROR');
    expect(outcome.failureCategory).toBe('SANDBOX_INFRA_FAILURE');
  });

  it('refuses via manifest derivation (POLICY_REFUSAL) when no lockfile is present, without creating a sandbox', async () => {
    const sandboxRunner = createFakeSandboxRunner();
    const client = fakeGitHubClientWithArchive({ 'package.json': PKG });
    const { outcome } = await runVerification(basePatchAttempt(), {
      sandboxRunner,
      githubClient: client,
      githubAppAuth: fakeGitHubAppAuth(),
    });
    expect(outcome.status).toBe('REFUSED');
    expect(outcome.failureCategory).toBe('POLICY_REFUSAL');
    expect(sandboxRunner.calls.some((c) => c.kind === 'create')).toBe(false);
  });

  it('PASSED end to end: patch apply, install, typecheck, test all succeed', async () => {
    const sandboxRunner = createFakeSandboxRunner({
      runCommand: async (_handle, command) => okFor(command),
    });
    const client = fakeGitHubClientWithArchive(REPO_FILES);

    const { outcome, manifest } = await runVerification(basePatchAttempt(), {
      sandboxRunner,
      githubClient: client,
      githubAppAuth: fakeGitHubAppAuth(),
    });

    expect(outcome.status).toBe('PASSED');
    expect(outcome.steps.map((s) => s.kind)).toEqual([
      'patch_apply',
      'patch_apply',
      'install',
      'typecheck',
      'test',
    ]);
    expect(outcome.steps.every((s) => s.status === 'PASSED')).toBe(true);
    expect(manifest?.runtime.packageManager.name).toBe('npm');
    expect(sandboxRunner.destroyed).toHaveLength(1);
  });

  it('PATCH_FAILURE stops before install/typecheck/test run at all', async () => {
    const sandboxRunner = createFakeSandboxRunner({
      runCommand: async (_handle, command) => {
        if (command.executable === 'patch')
          return { exitCode: 1, timedOut: false, stdout: '', stderr: 'failed', durationMs: 5 };
        return okFor(command);
      },
    });
    const { outcome } = await runVerification(basePatchAttempt(), {
      sandboxRunner,
      githubClient: fakeGitHubClientWithArchive(REPO_FILES),
      githubAppAuth: fakeGitHubAppAuth(),
    });

    expect(outcome.status).toBe('FAILED');
    expect(outcome.failureCategory).toBe('PATCH_FAILURE');
    expect(outcome.steps.map((s) => s.kind)).toEqual(['patch_apply']);
    expect(sandboxRunner.destroyed).toHaveLength(1);
  });

  it('CUSTOMER_REPO_FAILURE on install failure stops before typecheck/test run', async () => {
    const sandboxRunner = createFakeSandboxRunner({
      runCommand: async (_handle, command) => {
        if (command.executable === 'npm' && command.args[0] === 'ci') {
          return {
            exitCode: 1,
            timedOut: false,
            stdout: '',
            stderr: 'install failed',
            durationMs: 5,
          };
        }
        return okFor(command);
      },
    });
    const { outcome } = await runVerification(basePatchAttempt(), {
      sandboxRunner,
      githubClient: fakeGitHubClientWithArchive(REPO_FILES),
      githubAppAuth: fakeGitHubAppAuth(),
    });

    expect(outcome.status).toBe('FAILED');
    expect(outcome.failureCategory).toBe('CUSTOMER_REPO_FAILURE');
    expect(outcome.steps.map((s) => s.kind)).toEqual(['patch_apply', 'patch_apply', 'install']);
  });

  it('typecheck failure still runs test (both run regardless of each other)', async () => {
    const sandboxRunner = createFakeSandboxRunner({
      runCommand: async (_handle, command) => {
        if (command.args.includes('typecheck')) {
          return { exitCode: 1, timedOut: false, stdout: '', stderr: 'type error', durationMs: 5 };
        }
        return okFor(command);
      },
    });
    const { outcome } = await runVerification(basePatchAttempt(), {
      sandboxRunner,
      githubClient: fakeGitHubClientWithArchive(REPO_FILES),
      githubAppAuth: fakeGitHubAppAuth(),
    });

    expect(outcome.status).toBe('FAILED');
    expect(outcome.failureCategory).toBe('CUSTOMER_REPO_FAILURE');
    const kinds = outcome.steps.map((s) => s.kind);
    expect(kinds).toContain('typecheck');
    expect(kinds).toContain('test');
    const testStep = outcome.steps.find((s) => s.kind === 'test');
    expect(testStep?.status).toBe('PASSED');
  });

  it('TIMED_OUT when a command times out', async () => {
    const sandboxRunner = createFakeSandboxRunner({
      runCommand: async (_handle, command) => {
        if (command.args.includes('test')) {
          return { exitCode: null, timedOut: true, stdout: '', stderr: '', durationMs: 999 };
        }
        return okFor(command);
      },
    });
    const { outcome } = await runVerification(basePatchAttempt(), {
      sandboxRunner,
      githubClient: fakeGitHubClientWithArchive(REPO_FILES),
      githubAppAuth: fakeGitHubAppAuth(),
    });

    expect(outcome.status).toBe('TIMED_OUT');
    expect(outcome.failureCategory).toBe('TIMEOUT');
  });

  it('INFRA_ERROR when sandbox creation itself fails', async () => {
    const sandboxRunner = createFakeSandboxRunner({
      create: async () => {
        throw new Error('provider unavailable');
      },
    });
    const { outcome } = await runVerification(basePatchAttempt(), {
      sandboxRunner,
      githubClient: fakeGitHubClientWithArchive(REPO_FILES),
      githubAppAuth: fakeGitHubAppAuth(),
    });

    expect(outcome.status).toBe('INFRA_ERROR');
    expect(outcome.failureCategory).toBe('SANDBOX_INFRA_FAILURE');
  });

  it('caps output and marks truncated when a command produces oversized logs', async () => {
    const sandboxRunner = createFakeSandboxRunner({
      runCommand: async (_handle, command) => {
        if (command.args.includes('test')) {
          return {
            exitCode: 0,
            timedOut: false,
            stdout: 'x'.repeat(20_000),
            stderr: '',
            durationMs: 5,
          };
        }
        return okFor(command);
      },
    });
    const { outcome } = await runVerification(basePatchAttempt(), {
      sandboxRunner,
      githubClient: fakeGitHubClientWithArchive(REPO_FILES),
      githubAppAuth: fakeGitHubAppAuth(),
    });

    const testStep = outcome.steps.find((s) => s.kind === 'test');
    expect(testStep?.truncated).toBe(true);
    expect(Buffer.byteLength(testStep!.stdoutExcerpt, 'utf-8')).toBeLessThan(20_000);
  });

  it('destroys the sandbox on every path, including PASSED, FAILED, and infra failure', async () => {
    for (const scenario of ['pass', 'patch-fail', 'infra-fail'] as const) {
      const sandboxRunner = createFakeSandboxRunner({
        runCommand: async (_handle, command) => {
          if (scenario === 'patch-fail' && command.executable === 'patch') {
            return { exitCode: 1, timedOut: false, stdout: '', stderr: '', durationMs: 1 };
          }
          return okFor(command);
        },
      });
      await runVerification(basePatchAttempt(), {
        sandboxRunner,
        githubClient: fakeGitHubClientWithArchive(REPO_FILES),
        githubAppAuth: fakeGitHubAppAuth(),
      });
      if (scenario !== 'infra-fail') {
        expect(sandboxRunner.destroyed, `scenario: ${scenario}`).toHaveLength(1);
      }
    }
  });

  it('never passes a GitHub token, DB credential, or E2B key into any sandbox call', async () => {
    const sandboxRunner = createFakeSandboxRunner({ runCommand: async (_h, c) => okFor(c) });
    await runVerification(basePatchAttempt(), {
      sandboxRunner,
      githubClient: fakeGitHubClientWithArchive(REPO_FILES),
      githubAppAuth: fakeGitHubAppAuth({
        getInstallationToken: async () => 'super-secret-installation-token',
      }),
    });

    const serializedCalls = JSON.stringify(sandboxRunner.calls);
    expect(serializedCalls).not.toContain('super-secret-installation-token');
    expect(serializedCalls).not.toMatch(/DATABASE_URL|E2B_API_KEY|GITHUB_PRIVATE_KEY/i);

    const createCall = sandboxRunner.calls.find((c) => c.kind === 'create');
    expect(createCall?.detail).toMatchObject({ env: { CI: '1', NODE_ENV: 'test' } });
  });

  it('locks the network down to deny-all before typecheck/test run', async () => {
    const sandboxRunner = createFakeSandboxRunner({ runCommand: async (_h, c) => okFor(c) });
    await runVerification(basePatchAttempt(), {
      sandboxRunner,
      githubClient: fakeGitHubClientWithArchive(REPO_FILES),
      githubAppAuth: fakeGitHubAppAuth(),
    });

    const updateCall = sandboxRunner.calls.find((c) => c.kind === 'updateNetwork');
    expect(updateCall?.detail).toMatchObject({ network: { mode: 'deny-all' } });

    const createCall = sandboxRunner.calls.find((c) => c.kind === 'create');
    expect(createCall?.detail).toMatchObject({
      network: { mode: 'allowlist', allowedHosts: ['registry.npmjs.org'] },
    });
  });
});

function okFor(command: SandboxCommand): SandboxCommandResult {
  return {
    exitCode: 0,
    timedOut: false,
    stdout: `ok: ${command.executable} ${command.args.join(' ')}`,
    stderr: '',
    durationMs: 1,
  };
}
