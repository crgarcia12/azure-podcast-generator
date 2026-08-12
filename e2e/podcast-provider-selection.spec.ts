import { expect, test } from './fixtures';
import { registerUser } from './test-helpers';

test('listener can see and select real or mock podcast generation', async ({ page }) => {
  const username = `provider_${Math.random().toString(36).slice(2, 10)}`;
  await registerUser(page, username, 'SecurePass123!');

  await page.goto('/podcasts');

  await expect(page.getByRole('button', { name: /Real podcast/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mock audio/ })).toBeVisible();
  await page.getByRole('button', { name: /Real podcast/ }).click();
  await expect(page.getByRole('status').filter({
    hasText: 'Current source: Real podcast from Azure AI Foundry',
  })).toBeVisible();
  await page.getByRole('button', { name: /Mock audio/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Current source: Mock testing audio' })).toBeVisible();
});
