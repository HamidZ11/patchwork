import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@patchwork/db';
import { createWorker } from '../worker.js';

function fakeDbClient(): DbClient {
  return {
    db: {} as DbClient['db'],
    ping: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

describe('createWorker', () => {
  it('pings the database on start', async () => {
    const db = fakeDbClient();
    const worker = createWorker({ db, logger: pino({ level: 'silent' }) });

    await worker.start();

    expect(db.ping).toHaveBeenCalledOnce();
  });

  it('closes the database on stop', async () => {
    const db = fakeDbClient();
    const worker = createWorker({ db, logger: pino({ level: 'silent' }) });

    await worker.stop();

    expect(db.close).toHaveBeenCalledOnce();
  });
});
