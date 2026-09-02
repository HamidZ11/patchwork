import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@patchwork/db';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { createFakeSandboxRunner } from '../verification/__tests__/fake-sandbox-runner.js';
import { createWorker, type WorkerDeps } from '../worker.js';

function fakeDbClient(): DbClient {
  return {
    db: {} as DbClient['db'],
    ping: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function baseDeps(overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    db: fakeDbClient(),
    logger: pino({ level: 'silent' }),
    githubClient: {} as GitHubClient,
    githubAppAuth: {} as GitHubAppAuth,
    githubAppSlug: 'test-app',
    sandboxRunner: createFakeSandboxRunner(),
    ...overrides,
  };
}

describe('createWorker', () => {
  it('pings the database on start', async () => {
    const deps = baseDeps();
    const worker = createWorker(deps);

    await worker.start();
    await worker.stop();

    expect(deps.db.ping).toHaveBeenCalledOnce();
  });

  it('closes the database on stop', async () => {
    const deps = baseDeps();
    const worker = createWorker(deps);

    await worker.stop();

    expect(deps.db.close).toHaveBeenCalledOnce();
  });
});
