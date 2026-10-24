import { defineConfig } from 'vitest/config';

// Unit tests only; the Playwright browser tests in e2e/ run with `pnpm test:e2e`.
export default defineConfig({
  test: { include: ['src/**/*.spec.ts'] },
});
