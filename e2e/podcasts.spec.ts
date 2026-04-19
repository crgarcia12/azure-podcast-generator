import { test, expect } from '@playwright/test';
import { loginUser, registerUser, resetAppState, uniqueUser } from './test-helpers';

test.beforeEach(async ({ context }) => {
  await resetAppState(context);
});

test.describe('Podcast Generator', () => {
  test('@smoke authenticated user can generate a podcast episode on a phone-sized viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/podcasts');

    await expect(page.getByRole('heading', { name: /create a new episode/i })).toBeVisible();
    await page.getByLabel(/what should the episode be about/i).fill('History of Boeing');
    await page.getByRole('button', { name: /generate episode/i }).click();

    await expect(page.getByText(/history of boeing/i).first()).toBeVisible();
    await expect(page.getByText(/host/i).first()).toBeVisible();
    await expect(page.getByText(/guest/i).first()).toBeVisible();
    await expect(page.getByLabel(/podcast audio player/i)).toHaveAttribute('src', /\/api\/podcasts\/.+\/audio/);
    await expect(page.getByRole('button', { name: /download/i })).toBeVisible();
  });
});
