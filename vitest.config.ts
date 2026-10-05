import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/src/**/*.test.ts', 'server/src/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
