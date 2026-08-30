import { describe, expect, it } from 'vitest';
import { loadEnv } from '../env.js';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  API_PORT: '3001',
  LOG_LEVEL: 'info',
};

describe('loadEnv', () => {
  it('parses a valid environment', () => {
    const env = loadEnv(validEnv);

    expect(env.NODE_ENV).toBe('test');
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.API_PORT).toBe(3001);
  });

  it('applies defaults for optional values', () => {
    const env = loadEnv({ DATABASE_URL: validEnv.DATABASE_URL });

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('throws a readable error when DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrowError(/DATABASE_URL/);
  });

  it('throws a readable error when DATABASE_URL is not a valid url', () => {
    expect(() => loadEnv({ DATABASE_URL: 'not-a-url' })).toThrowError(/DATABASE_URL/);
  });
});
