import { test, expect } from '@playwright/test';
import { loginUser, registerUser, resetAppState, uniqueUser } from './test-helpers';

test.beforeEach(async ({ context }) => {
  await resetAppState(context);
});

test.describe('Registration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
  });

  test('should register a new user and redirect to login with success message', async ({ page }) => {
    const username = uniqueUser();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill('SecurePass123!');
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/registration successful/i)).toBeVisible();
  });

  test('should show error when registering with duplicate username', async ({ page }) => {
    const username = uniqueUser();
    await registerUser(page, username, 'SecurePass123!');

    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill('SecurePass123!');
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page.getByText(/already exists/i)).toBeVisible();
  });

  test('should show validation error for invalid username', async ({ page }) => {
    await page.getByLabel('Username').fill('ab');
    await page.getByLabel('Password').fill('SecurePass123!');
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page.getByText('Username must be between 3 and 30 characters and contain only letters, numbers, and underscores')).toBeVisible();
  });

  test('should show validation error for short password', async ({ page }) => {
    await page.getByLabel('Username').fill(uniqueUser());
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
  });

  test('should have a link to login page', async ({ page }) => {
    const loginLink = page.getByRole('link', { name: /sign in/i });
    await expect(loginLink).toBeVisible();
    await loginLink.click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should login with valid credentials and redirect to the podcast studio', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);

    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page).toHaveURL(/\/podcasts/);
    await expect(page.getByRole('heading', { name: /create a new episode/i })).toBeVisible();
  });

  test('should show error for wrong password', async ({ page }) => {
    const username = uniqueUser();
    await registerUser(page, username, 'SecurePass123!');

    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill('WrongPassword!');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByText('Invalid username or password')).toBeVisible();
  });

  test('should show error for non-existent user', async ({ page }) => {
    await page.getByLabel('Username').fill('nonexistent_user_xyz');
    await page.getByLabel('Password').fill('SomePassword123!');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByText('Invalid username or password')).toBeVisible();
  });

  test('should show PodCraft sign-in copy', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByText(/sign in to your podcraft account/i)).toBeVisible();
  });

  test('should show success message when redirected after registration', async ({ page }) => {
    await page.goto('/login?registered=true');
    await expect(page.getByText(/registration successful/i)).toBeVisible();
  });
});

test.describe('Logout', () => {
  test('should logout and redirect to login', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/profile');
    await page.getByRole('button', { name: /logout/i }).click();

    await expect(page).toHaveURL(/\/login/);
  });

  test('should redirect to login when visiting profile after logout', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/profile');
    await page.getByRole('button', { name: /logout/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/profile');
    await expect(page).toHaveURL(/\/login/);
  });
});
