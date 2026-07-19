import { expect, test } from '@playwright/test';

test('continuous podcast shows progress, transcript, and stop controls', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Podcast topic').fill('History of Boeing');
  await page.getByRole('button', { name: 'Go' }).click();

  await expect(page.getByRole('heading', { name: 'History of Boeing' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Podcast generation progress' })).toBeVisible();
  await expect(page.getByText(/generating|complete/i).first()).toBeVisible();
  await expect(page.getByRole('log', { name: 'Podcast transcript' })).toContainText('History of Boeing', {
    ignoreCase: true,
  });

  await page.getByRole('button', { name: 'Stop generation' }).click({ force: true });
  await expect(page.getByText('Stopped', { exact: true }).first()).toBeVisible();
});
