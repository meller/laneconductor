// playwright.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './conductor/tests/playwright',
  timeout: 180000,
  retries: 0,
  workers: 1, // sequential — tests share state (track number)
  use: {
    baseURL: 'http://localhost:8090',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
