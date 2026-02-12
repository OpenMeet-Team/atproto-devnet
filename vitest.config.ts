import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    globals: true,
    // Tests run sequentially — they share a Docker environment
    sequence: {
      concurrent: false,
    },
    // Run test files in dependency order
    include: ['test/**/*.test.ts'],
  },
});
