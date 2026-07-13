import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
  resolve: {
    // Allow importing web/ helpers that use .ts extensions in tests.
    extensions: ['.ts', '.tsx', '.js'],
  },
});
