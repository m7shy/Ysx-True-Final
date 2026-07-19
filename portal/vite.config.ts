import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Client-portal SPA — second Vite app in this repo, served by the same Express
// backend at /portal (see server/src/index.ts). Shares src/design (tokens,
// motion, ui primitives) with the CRM via the '@' alias to the repo root.
export default defineConfig({
  // Vite's default `root` is process.cwd(), NOT this config file's directory —
  // without this, running `vite build --config portal/vite.config.ts` from the
  // repo root silently builds the CRM's root index.html/index.tsx instead of
  // portal/index.html. Pin it explicitly so the entry is always this app.
  root: path.resolve(__dirname),
  base: '/portal/',
  server: {
    port: 3002,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '..'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist-portal'),
    emptyOutDir: true,
  },
});
