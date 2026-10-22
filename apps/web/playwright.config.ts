import { defineConfig, devices } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The real API (built) serving the built web app, with the fake Hermes and a throwaway Postgres
// schema. Needs `pnpm build` first and Postgres at DATABASE_URL.
const PORT = 3200;
process.env.E2E_SCHEMA ??= `e2e_${randomBytes(4).toString('hex')}`;
const api = resolve(import.meta.dirname, '../api');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node ${join(api, 'dist/main.js')}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgres://evals:evals-local-only@127.0.0.1:55433/evals',
      DB_SCHEMA: process.env.E2E_SCHEMA,
      HERMES_BIN: join(api, 'test/fake-hermes.mjs'),
      RUNS_DIR: mkdtempSync(join(tmpdir(), 'evals-e2e-')),
      SUITES_DIR: resolve(import.meta.dirname, '../../suites'),
      SKILLS_DIR: resolve(import.meta.dirname, '../../skills'),
      WEB_DIST: resolve(import.meta.dirname, 'dist'),
      OPENAI_API_KEY: 'sk-test-only',
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
    },
  },
});
