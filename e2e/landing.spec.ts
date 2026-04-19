import { test, expect } from '@playwright/test';
import { loginUser, registerUser, resetAppState, uniqueUser } from './test-helpers';

test.beforeEach(async ({ context }) => {
  await resetAppState(context);
});

test.describe('Landing Page', () => {
  test('@smoke guest should see the PodCraft hero and sign-in CTA', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /turn any topic into a podcast episode/i })).toBeVisible();
    await expect(page.getByText(/podcraft generates an engaging interview-style script/i)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: /sign in to start/i })).toBeVisible();
  });

  test('authenticated user should see the studio CTA on the landing page', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/');

    await expect(page.getByRole('link', { name: /open studio/i })).toBeVisible();
  });
});
