import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Component tests for apps/web. Deliberately narrow: this exists for the
 * client components that hold real state -- today the assessment selector and
 * the explanation panel it mounts -- not for server components or pages, which
 * are already covered by apps/api's integration tests and by rendering the
 * real app.
 *
 * No `@vitejs/plugin-react`: the tests need the JSX transform and nothing else
 * the plugin adds (Fast Refresh, the dev runtime), and the published plugin
 * types are built against a different major of Vite than Vitest resolves here,
 * which fails typecheck. esbuild's automatic runtime does the transform
 * directly -- one fewer dependency, and one fewer version to keep aligned.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
