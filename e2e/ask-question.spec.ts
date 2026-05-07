import { test, expect } from '@playwright/test';
import { loginUser, registerUser, resetAppState, uniqueUser } from './test-helpers';

const QUESTION = 'What happens if I cross the event horizon with one eye only, what do I see';

test.beforeEach(async ({ context }) => {
  await resetAppState(context);
});

test.describe('Mid-episode listener question steering', () => {
  test('@ask-question voice question pauses, plays steered segment, resumes original audio', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const username = uniqueUser('alex');
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    // Stub Web Speech API BEFORE the page loads so the player picks it up.
    await page.addInitScript(({ question }) => {
      class FakeSpeechRecognition {
        continuous = false;
        interimResults = false;
        lang = 'en-US';
        onresult: ((event: unknown) => void) | null = null;
        onerror: (() => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          setTimeout(() => {
            this.onresult?.({ results: [[{ transcript: question }]] });
            this.onend?.();
          }, 50);
        }
        stop() {
          /* no-op */
        }
      }
      Object.defineProperty(window, 'SpeechRecognition', {
        configurable: true,
        value: FakeSpeechRecognition,
      });
      Object.defineProperty(window, 'webkitSpeechRecognition', {
        configurable: true,
        value: FakeSpeechRecognition,
      });
    }, { question: QUESTION });

    await page.goto('/podcasts');

    // Generate an episode on a universe-themed topic so the host/guest reference
    // black holes in the steered segment is plausible.
    await expect(page.getByRole('heading', { name: /create a new episode/i })).toBeVisible();
    await page.getByLabel(/what should the episode be about/i).fill('How the universe works');
    await page.getByRole('button', { name: /generate episode/i }).click();

    const player = page.getByLabel(/podcast audio player/i);
    await expect(player).toHaveAttribute('src', /\/api\/podcasts\/.+\/audio/, { timeout: 30_000 });

    // Force the player time forward so the resume position is observable.
    await player.evaluate((node) => {
      const audio = node as HTMLAudioElement;
      audio.muted = true;
      audio.currentTime = 4;
    });

    // The Ask-a-question button must exist and be at least 64x64 px.
    const askButton = page.getByRole('button', { name: /ask a question/i });
    await expect(askButton).toBeVisible();
    const box = await askButton.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(64);
    expect(box!.height).toBeGreaterThanOrEqual(64);

    // Capture the API request triggered by the click.
    const apiRequestPromise = page.waitForRequest(
      (req) =>
        req.method() === 'POST' && /\/api\/podcasts\/[^/]+\/questions/.test(req.url()),
    );
    const apiResponsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        /\/api\/podcasts\/[^/]+\/questions/.test(res.url()) &&
        res.status() === 200,
    );

    await askButton.click();

    const apiRequest = await apiRequestPromise;
    const requestBody = apiRequest.postDataJSON() as {
      question: string;
      playbackPositionSeconds: number;
    };
    expect(requestBody.question.toLowerCase()).toContain('event horizon');
    expect(requestBody.playbackPositionSeconds).toBeGreaterThan(0);

    const apiResponse = await apiResponsePromise;
    const responseBody = (await apiResponse.json()) as {
      segment: {
        segmentId: string;
        transcript: { speaker: 'host' | 'guest'; text: string }[];
        audioUrl: string;
      };
    };
    expect(responseBody.segment.segmentId).toBeTruthy();
    expect(responseBody.segment.transcript[0].speaker).toBe('host');
    expect(responseBody.segment.transcript[1].speaker).toBe('guest');
    expect(
      responseBody.segment.transcript[responseBody.segment.transcript.length - 1].speaker,
    ).toBe('host');
    expect(responseBody.segment.transcript[1].text.toLowerCase()).toContain('event horizon');

    // While the steered segment is playing the player src points at the segment endpoint.
    await expect(player).toHaveAttribute('src', /\/segments\/[^/]+\/audio/, { timeout: 10_000 });

    // The transcript shows the steered segment labelled as a Listener question.
    await page.getByRole('button', { name: /^transcript/i }).click();
    const listenerBlock = page.locator('[data-listener-question="true"]');
    await expect(listenerBlock).toBeVisible();
    await expect(listenerBlock).toContainText(/listener question/i);
    await expect(listenerBlock).toContainText(/event horizon/i);
  });

  test('@ask-question fallback text-input modal submits the question when SpeechRecognition is undefined', async ({
    page,
  }) => {
    const username = uniqueUser('alex');
    const password = 'SecurePass123!';
    await registerUser(page, username, password);
    await loginUser(page, username, password);

    // Strip out SpeechRecognition entirely.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
      Object.defineProperty(window, 'webkitSpeechRecognition', {
        configurable: true,
        value: undefined,
      });
    });

    await page.goto('/podcasts');

    await page.getByLabel(/what should the episode be about/i).fill('How the universe works');
    await page.getByRole('button', { name: /generate episode/i }).click();

    const player = page.getByLabel(/podcast audio player/i);
    await expect(player).toHaveAttribute('src', /\/api\/podcasts\/.+\/audio/, { timeout: 30_000 });
    await player.evaluate((node) => {
      const audio = node as HTMLAudioElement;
      audio.muted = true;
    });

    const askButton = page.getByRole('button', { name: /ask a question/i });
    await askButton.click();

    const modalTextarea = page.getByLabel(/type your question/i);
    await expect(modalTextarea).toBeVisible();
    await modalTextarea.fill(QUESTION);

    const apiRequestPromise = page.waitForRequest(
      (req) =>
        req.method() === 'POST' && /\/api\/podcasts\/[^/]+\/questions/.test(req.url()),
    );

    await page.getByRole('button', { name: /send question/i }).click();
    const apiRequest = await apiRequestPromise;
    const requestBody = apiRequest.postDataJSON() as { question: string };
    expect(requestBody.question).toContain('event horizon');
  });
});
