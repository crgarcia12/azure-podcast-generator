import { test, expect } from '@playwright/test';
import { loginUser, registerUser, resetAppState, uniqueUser } from './test-helpers';

test.beforeEach(async ({ context }) => {
  await resetAppState(context);
});

test.describe('Navigation Bar', () => {
  test('guest should see Sign in but not authenticated navigation links', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation');

    await expect(nav.getByRole('link', { name: /sign in/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /profile/i })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: /admin/i })).not.toBeVisible();
    await expect(nav.getByRole('button', { name: /sign out/i })).not.toBeVisible();
  });

  test('logged-in user should see Studio, Profile, and Sign out but not Sign in or Admin', async ({ page }) => {
    // Register a dummy admin first so the test user gets 'user' role
    await registerUser(page, uniqueUser(), 'SecurePass123!');
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/');
    const nav = page.getByRole('navigation');

    await expect(nav.getByRole('link', { name: /studio/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /profile/i })).toBeVisible();
    await expect(nav.getByRole('button', { name: /sign out/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /sign in/i })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: /admin/i })).not.toBeVisible();
  });

  test('admin user should see Studio, Profile, Admin, and Sign out', async ({ page }) => {
    // The first registered user becomes admin
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/');
    const nav = page.getByRole('navigation');

    await expect(nav.getByRole('link', { name: /studio/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /profile/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /admin/i })).toBeVisible();
    await expect(nav.getByRole('button', { name: /sign out/i })).toBeVisible();
  });
});
