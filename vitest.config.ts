// FILE: vitest.config.ts
//
// Frontend test runner. Separate from vite.config.ts on purpose: that config
// carries a dev-server proxy and a `define` that inlines the Gemini API key from
// the environment, neither of which belongs in a test process.
//
// Why this exists: until now the frontend had NO test runner at all — root
// package.json had `dev`/`build`/`preview` and nothing else, and every test in
// the repo was server-side. That left ~13k lines of component tree, the client
// portal, and every service wrapper verified by `tsc` and reading alone. Several
// real defects fixed on 2026-07-28 (the portal white-screening on reload, the
// campaign wizard wedging permanently, a success toast shown on a failed send)
// were all found by eye, and none could be pinned with a failing test.

import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // The server has its own vitest project with its own config; including it
    // here would run every server test twice under jsdom, where they do not
    // belong.
    include: ['test/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}', 'portal/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'server/**', 'dist/**', 'dist-portal/**', 'dist_pre_refactor_backup/**'],
  },
});
