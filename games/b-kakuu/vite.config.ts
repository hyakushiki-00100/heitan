import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  // 画面に出す版(package.json の version)
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      '@hyoro/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@hyoro/platform': fileURLToPath(new URL('../../packages/platform/src/index.ts', import.meta.url)),
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
