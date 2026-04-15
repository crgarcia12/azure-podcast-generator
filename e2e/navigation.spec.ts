import { test, expect } from '@playwright/test';
import { loginUser, registerUser, resetAppState, uniqueUser } from './test-helpers';

test.beforeEach(async ({ context }) => {
  await resetAppState(context);
});

test.describe('Navigation Bar', () => {
  test('guest should see Login and Register links but not Profile or Logout', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation');

    await expect(nav.getByRole('link', { name: /login/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /register/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /profile/i })).not.toBeVisible();
    await expect(nav.getByRole('button', { name: /logout/i })).not.toBeVisible();
  });

  test('logged-in user should see Profile and Logout but not Login, Register, or Admin', async ({ page }) => {
    // Register a dummy admin first so the test user gets 'user' role
    await registerUser(page, uniqueUser(), 'SecurePass123!');
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/');
    const nav = page.getByRole('navigation');

    await expect(nav.getByRole('link', { name: /profile/i })).toBeVisible();
    await expect(nav.getByRole('button', { name: /logout/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /login/i })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: /register/i })).not.toBeVisible();
    await expect(nav.getByRole('link', { name: /admin/i })).not.toBeVisible();
  });

  test('admin user should see Profile, Admin, and Logout', async ({ page }) => {
    // The first registered user becomes admin
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/');
    const nav = page.getByRole('navigation');

    await expect(nav.getByRole('link', { name: /profile/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /admin/i })).toBeVisible();
    await expect(nav.getByRole('button', { name: /logout/i })).toBeVisible();
  });
});
