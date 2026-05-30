import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Only run TypeScript source tests. Never pick up compiled tests that may
    // exist under dist/ (those caused the suite to run twice).
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
    },
  },
});
