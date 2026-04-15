import { test, expect } from '@playwright/test';
import { loginUser, registerUser, resetAppState, uniqueUser } from './test-helpers';

test.beforeEach(async ({ context }) => {
  await resetAppState(context);
});

test.describe('Profile Page', () => {
  test('should display username, role badge, and member since date for authenticated user', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/profile');

    await expect(page.getByText(username)).toBeVisible();
    await expect(page.locator('[data-testid="role-badge"]')).toBeVisible();
    await expect(page.getByText(/member since/i)).toBeVisible();
  });

  test('should redirect unauthenticated user to login', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/login/);
  });

  test('should logout from profile page', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/profile');
    await page.getByRole('button', { name: /logout/i }).click();

    await expect(page).toHaveURL(/\/login/);
  });
});
