import { defineConfig } from 'vitest/config';

// Needs Postgres (DATABASE_URL). Each test file migrates its own throwaway schema.
export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.int.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
