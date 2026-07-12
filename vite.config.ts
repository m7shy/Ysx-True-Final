import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Dev-only: forward API calls to the local backend so the browser makes
        // same-origin requests. Required because the backend's CORS is pinned to
        // WEB_ORIGIN (https://ysxvisuals.online on this VM), which blocks a
        // cross-origin localhost:3000 frontend. Pair with VITE_API_URL="" so
        // apiClient uses relative URLs in dev (see services/apiClient.ts).
        proxy: {
          '/api': { target: 'http://localhost:3001', changeOrigin: true },
          // Regex: '/t' as a plain key is a prefix match and would swallow
          // /types.ts (breaking the dev module graph); only proxy /t/<id>.
          '^/t/': { target: 'http://localhost:3001', changeOrigin: true },
        },
      },
      plugins: [react(), tailwindcss()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
