import { test, expect } from '@playwright/test';
import {
  getAdminCredentials,
  isRemoteEnvironment,
  loginUser,
  registerUser,
  resetAppState,
  uniqueUser,
} from './test-helpers';

test.beforeEach(async ({ context }) => {
  await resetAppState(context);
});

test.describe('Admin Dashboard', () => {
  test('admin should see a table with all users', async ({ page }) => {
    const password = 'SecurePass123!';
    let adminUser = uniqueUser('admin');
    let adminPassword = password;

    if (isRemoteEnvironment()) {
      const seededAdmin = getAdminCredentials();
      adminUser = seededAdmin.username;
      adminPassword = seededAdmin.password;
      await loginUser(page, seededAdmin.username, seededAdmin.password);
    } else {
      await registerUser(page, adminUser, password);
    }

    // Register a second regular user
    const regularUser = uniqueUser();
    await registerUser(page, regularUser, password);
    await loginUser(page, adminUser, adminPassword);

    await page.goto('/admin');

    await expect(page.getByRole('columnheader', { name: /username/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('columnheader', { name: /role/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /member since/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: adminUser })).toBeVisible();
    await expect(page.getByRole('cell', { name: regularUser })).toBeVisible();
  });

  test('non-admin user should see access denied message', async ({ page }) => {
    if (!isRemoteEnvironment()) {
      await registerUser(page, uniqueUser('admin'), 'SecurePass123!');
    }

    // Create and login as regular user
    const regularUser = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, regularUser, password);
    await loginUser(page, regularUser, password);

    await page.goto('/admin');

    await expect(page.getByText('Access Denied')).toBeVisible();
    await expect(page.getByText('You do not have permission to view this page.')).toBeVisible();
  });

  test('unauthenticated user should be redirected to login', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });
});
