import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
export default defineConfig({ root: resolve(import.meta.dirname), plugins: [vue()],
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001', changeOrigin: true } } },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
