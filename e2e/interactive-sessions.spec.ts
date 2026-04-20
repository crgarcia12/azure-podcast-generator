import { test, expect } from '@playwright/test';
import { loginUser, registerUser, resetAppState, uniqueUser, getApiBaseUrl } from './test-helpers';

test.beforeEach(async ({ context }) => {
  await resetAppState(context);
});

test.describe('Interactive Podcast Sessions', () => {
  test('authenticated user can create an interactive session', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/podcasts/sessions');
    await expect(page.getByRole('heading', { name: /interactive sessions/i })).toBeVisible();

    // Create a new session
    await page.getByPlaceholder(/enter a topic/i).fill('artificial intelligence');
    await page.getByRole('button', { name: /create/i }).click();

    // Should navigate to session player
    await page.waitForURL(/\/podcasts\/sessions\/.+/);
    await expect(page.getByText(/host/i).first()).toBeVisible();
    await expect(page.getByText(/guest/i).first()).toBeVisible();
    await expect(page.getByText(/segment 1 of/i)).toBeVisible();
  });

  test('session player shows segment controls', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    // Create session via API
    const createRes = await page.request.post(`${getApiBaseUrl()}/api/podcasts/sessions`, {
      data: { topic: 'machine learning' },
    });
    expect(createRes.ok()).toBeTruthy();
    const { session } = await createRes.json();

    await page.goto(`/podcasts/sessions/${session.id}`);

    // Verify controls
    await expect(page.getByRole('button', { name: /play/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /previous segment/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /next segment/i })).toBeVisible();
  });

  test('user can submit a text interrupt', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    // Create session via API
    const createRes = await page.request.post(`${getApiBaseUrl()}/api/podcasts/sessions`, {
      data: { topic: 'quantum computing' },
    });
    const { session } = await createRes.json();

    await page.goto(`/podcasts/sessions/${session.id}`);

    // Type and submit a question
    await page.getByPlaceholder(/type your question/i).fill('What about quantum supremacy?');
    await page.getByRole('button', { name: /send question/i }).click();

    // Wait for interrupt processing
    await expect(page.getByText(/processing your question/i)).toBeVisible();
    await expect(page.getByText(/processing your question/i)).not.toBeVisible({ timeout: 15000 });

    // Verify interrupt appears in transcript
    await expect(page.getByText(/you asked/i).first()).toBeVisible();
    await expect(page.getByText(/quantum supremacy/i).first()).toBeVisible();
  });

  test('session list shows past sessions', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    // Create two sessions via API
    await page.request.post(`${getApiBaseUrl()}/api/podcasts/sessions`, {
      data: { topic: 'topic one' },
    });
    await page.request.post(`${getApiBaseUrl()}/api/podcasts/sessions`, {
      data: { topic: 'topic two' },
    });

    await page.goto('/podcasts/sessions');

    await expect(page.getByText('topic one')).toBeVisible();
    await expect(page.getByText('topic two')).toBeVisible();
    await expect(page.getByText(/segments/i).first()).toBeVisible();
  });

  test('user can delete a session', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    // Create session via API
    await page.request.post(`${getApiBaseUrl()}/api/podcasts/sessions`, {
      data: { topic: 'to be deleted' },
    });

    await page.goto('/podcasts/sessions');
    await expect(page.getByText('to be deleted')).toBeVisible();

    // Delete it
    await page.getByRole('button', { name: /delete session/i }).click();
    await expect(page.getByText('to be deleted')).not.toBeVisible();
  });

  test('navigation bar shows Interactive link when authenticated', async ({ page }) => {
    const username = uniqueUser();
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    await page.goto('/');
    // Desktop nav
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByRole('link', { name: /interactive/i }).first()).toBeVisible();
  });
});
