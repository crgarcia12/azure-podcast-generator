import { test as base } from '@playwright/test';
import { getApiBaseUrl, isRemoteEnvironment } from './test-helpers';

// Extended test fixture that resets the in-memory user store before each test
export const test = base.extend({
  page: async ({ page }, use) => {
    if (!isRemoteEnvironment()) {
      await page.request.post(`${getApiBaseUrl()}/api/test/reset`);
    }
    await use(page);
  },
});

export { expect } from '@playwright/test';
