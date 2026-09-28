import { defineConfig } from 'vitest/config';

/** End-to-end tests: mock aggregator + real Chromium. Run with `npm run test:e2e`. */
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
