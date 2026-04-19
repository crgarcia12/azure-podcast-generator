import type { FullConfig } from '@playwright/test';
import {
  clearStartedState,
  ensureDotnetToolsOnPath,
  isAspireRunning,
  isServerRunning,
  startAspireAndWaitForWeb,
  waitForWeb,
  writeStartedState,
} from './aspire-lifecycle';

export default async function globalSetup(config: FullConfig): Promise<void> {
  ensureDotnetToolsOnPath();
  clearStartedState();

  if (process.env.PLAYWRIGHT_BASE_URL) {
    return;
  }

  const baseURL = config.projects[0]?.use?.baseURL;
  const targetUrl = typeof baseURL === 'string' ? baseURL : 'http://localhost:3001';

  if (await isServerRunning(targetUrl)) {
    return;
  }

  if (isAspireRunning()) {
    waitForWeb();
    return;
  }

  startAspireAndWaitForWeb();
  writeStartedState();
}
