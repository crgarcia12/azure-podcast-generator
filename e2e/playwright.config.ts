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
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: `aspire start --apphost "${appHostPath}" --nologo && aspire wait web --apphost "${appHostPath}" --status healthy --timeout 90 --nologo`,
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
