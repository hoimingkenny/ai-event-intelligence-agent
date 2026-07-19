import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./vitest.globalSetup.ts'],
    // DB-backed tests share the single app_test schema and global tables
    // (e.g. cve_refresh_state), so files must not run concurrently.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
  resolve: {
    // Allow importing web/ helpers that use .ts extensions in tests.
    extensions: ['.ts', '.tsx', '.js'],
  },
});
