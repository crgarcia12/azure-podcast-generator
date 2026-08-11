import { test, expect } from './fixtures';

const session = {
  id: 'session-1',
  topic: 'History of Boeing',
  title: 'History of Boeing in Conversation',
  summary: 'An interview about aviation history.',
  controls: {
    audienceLevel: 'intermediate',
    durationMinutes: 10,
    conversationStyle: 'conversational',
  },
  generationState: 'preparing-audio',
  estimatedDurationMinutes: 10,
  transcript: [
    { speaker: 'host', text: 'How did Boeing begin?' },
    { speaker: 'guest', text: 'It began by building aircraft in the Pacific Northwest.' },
  ],
  segments: [
    {
      id: 'segment-1',
      index: 0,
      turns: [
        { speaker: 'host', text: 'How did Boeing begin?' },
        { speaker: 'guest', text: 'It began by building aircraft in the Pacific Northwest.' },
      ],
      status: 'ready',
      audioUrl: '/api/podcasts/sessions/session-1/segments/segment-1/audio',
    },
    {
      id: 'segment-2',
      index: 1,
      turns: [
        { speaker: 'host', text: 'What changed with jet travel?' },
        { speaker: 'guest', text: 'Jets made long-distance travel faster and more practical.' },
      ],
      status: 'pending',
      audioUrl: '/api/podcasts/sessions/session-1/segments/segment-2/audio',
    },
  ],
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

test('submits the default podcast controls and exposes progressive state', async ({ page }) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route('**/api/podcasts/sessions', async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ session }) });
  });
  await page.route('**/api/podcasts/sessions/session-1', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session }) });
  });

  await page.goto('/podcasts');
  await expect(page.getByLabel('Audience level')).toHaveValue('intermediate');
  await expect(page.getByLabel('Episode length')).toHaveValue('10');
  await expect(page.getByLabel('Conversation style')).toHaveValue('conversational');

  await page.getByLabel('Topic').fill('History of Boeing');
  await page.getByRole('button', { name: 'Generate episode' }).click();

  expect(requestBody).toMatchObject({
    topic: 'History of Boeing',
    audienceLevel: 'intermediate',
    durationMinutes: 10,
    conversationStyle: 'conversational',
  });
  await expect(page.getByText('Status:')).toContainText('Preparing audio');
  await expect(page.getByRole('button', { name: 'Ask a question' }).first()).toBeEnabled();
});

test('keeps retry and resume actions available after an intervention failure', async ({ page }) => {
  await page.route('**/api/podcasts/sessions', async (route) => {
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ session }) });
  });
  await page.route('**/api/podcasts/sessions/session-1/interventions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        intervention: {
          id: 'intervention-1',
          state: 'failed',
          capturedPositionSeconds: 42,
          errorCode: 'INTERVENTION_FAILED',
        },
      }),
    });
  });

  await page.goto('/podcasts');
  await page.getByLabel('Topic').fill('History of Boeing');
  await page.getByRole('button', { name: 'Generate episode' }).click();
  await page.getByRole('button', { name: 'Ask a question' }).first().click();
  await page.getByLabel('Your question').fill('Why did jet engines matter?');
  await page.getByRole('button', { name: 'Ask a question' }).last().click();

  await expect(page.getByRole('status')).toContainText('Question failed');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume episode' })).toBeVisible();
});
