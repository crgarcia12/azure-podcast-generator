import { test, expect } from './fixtures';
import { registerUser } from './test-helpers';

test('listener configures a progressive episode and asks a question', async ({ page }) => {
  const username = `pod_${Math.random().toString(36).slice(2, 10)}`;
  const password = 'SecurePass123!';
  await registerUser(page, username, password);

  let generationPayload: Record<string, unknown> | undefined;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/podcasts')) {
      generationPayload = request.postDataJSON() as Record<string, unknown>;
    }
  });

  await page.goto('/podcasts');
  await expect(page.getByLabel('Audience level')).toHaveValue('Intermediate');
  await expect(page.getByLabel('Episode length')).toHaveValue('5');
  await expect(page.getByLabel('Conversation style')).toHaveValue('Conversational');

  await page.getByLabel('What should we explore?').fill('History of Boeing');
  await page.getByLabel('Audience level').selectOption('Beginner');
  await page.getByRole('button', { name: 'Generate episode' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Preparing audio' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play episode' })).toBeEnabled();
  expect(generationPayload).toMatchObject({
    topic: 'History of Boeing',
    audience: 'Beginner',
    durationMinutes: 5,
    style: 'Conversational',
  });

  await page.getByRole('button', { name: 'Ask a question' }).press('Enter');
  await expect(page.getByLabel('Question for the hosts')).toBeFocused();
  await page.getByLabel('Question for the hosts').fill('Why did jet engines matter?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Question received|Answering question|Answer playing/ })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume episode' })).toBeVisible();
});
