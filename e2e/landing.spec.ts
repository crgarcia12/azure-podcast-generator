import { test, expect } from '@playwright/test';
import { loginUser, registerUser, resetAppState, uniqueUser } from './test-helpers';

test.beforeEach(async ({ context }) => {
  await resetAppState(context);
});

test.describe('Landing Page', () => {
  test('@smoke guest should see heading, description, and Login/Register CTAs', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /userauth/i })).toBeVisible();
    await expect(page.getByText(/simple authentication demo/i)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: /login/i })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: /register/i })).toBeVisible();
  });

  test('authenticated user should see "Go to Profile" link instead of Login/Register', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/');

    await expect(page.getByRole('link', { name: /go to profile/i })).toBeVisible();
  });
});
