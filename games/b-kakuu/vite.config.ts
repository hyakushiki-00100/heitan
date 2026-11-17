import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@hyoro/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
