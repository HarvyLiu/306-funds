import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', {open: 'never', outputFolder: 'playwright-report'}]]
    : [['list'], ['html', {open: 'never', outputFolder: 'playwright-report'}]],
  use: {
    baseURL: 'http://127.0.0.1:4321',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop',
      use: {viewport: {width: 1440, height: 900}},
    },
    {
      name: 'mobile',
      use: {viewport: {width: 390, height: 844}},
    },
  ],
  webServer: {
    command:
      'LEDGER_ROOT=./test/fixtures/repo npm run build && npm run preview -- --host 127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:4321',
    reuseExistingServer: false,
  },
});
