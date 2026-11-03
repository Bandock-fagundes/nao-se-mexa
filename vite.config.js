import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: 'client',
  base: '/',
  build: {
    outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { main: resolve('client/index.html'), lab: resolve('client/lab.html') } },
  },
  server: { fs: { allow: ['..'] } },
});
