import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const local = '/Users/saundarya/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell';
export default defineConfig({ testDir: '.', testMatch: '*.spec.ts', workers: 1, timeout: 90000,
  outputDir: '../../output/browser', reporter: 'list',
  use: { baseURL: process.env.EVAL_WEB_URL ?? 'http://127.0.0.1:5173', actionTimeout: 10000, viewport: { width: 1440, height: 1000 },
    video: 'on', screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.EVAL_CHROMIUM ?? (existsSync(local) ? local : undefined) } },
});
