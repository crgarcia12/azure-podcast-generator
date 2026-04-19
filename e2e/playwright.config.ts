import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const dotnetToolsPath = path.join(os.homedir(), '.dotnet', 'tools');
if (!process.env.PATH?.split(path.delimiter).includes(dotnetToolsPath)) {
  process.env.PATH = process.env.PATH
    ? `${process.env.PATH}${path.delimiter}${dotnetToolsPath}`
    : dotnetToolsPath;
}
const appHostPath = path.join(process.cwd(), 'apphost.cs');

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
