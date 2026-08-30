import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15_000,
  },
});
