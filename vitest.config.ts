import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@hyoro/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@hyoro/platform': fileURLToPath(new URL('./packages/platform/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['packages/*/tests/**/*.test.ts', 'games/*/tests/**/*.test.ts'], testTimeout: 60000 },
});
