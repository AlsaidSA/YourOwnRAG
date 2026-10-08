import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { defineConfig } from 'vite';

// OwnRAG console. The API contract is the preserved backend: `/api/v1/*` and `/v1/*`
// are served by the Go server (default :9380); the admin API is served on :9381.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/v1/admin': {
        target: 'http://127.0.0.1:9381/',
        changeOrigin: true,
        ws: true,
      },
      '/api': {
        target: 'http://127.0.0.1:9380/',
        changeOrigin: true,
        ws: true,
      },
      '/v1': {
        target: 'http://127.0.0.1:9380/',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
