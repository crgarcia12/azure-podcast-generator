import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { CustomWorld } from '../support/world';

interface EpisodeResponse {
  id: string;
  controls: { audience: string; durationMinutes: number; style: string };
  generationStatus: string;
  transcript: Array<{ speaker: 'host' | 'guest'; text: string }>;
  audioSegments: Array<{ status: string }>;
}

let episode: EpisodeResponse | null = null;

Given('a signed-in podcast listener', async function (this: CustomWorld) {
  const username = `pod_${Math.random().toString(36).slice(2, 10)}`;
  const password = 'SecurePass123!';
  await this.apiRequest('POST', '/api/auth/register', { username, password });
  assert.equal(this.response?.status, 201);
});

When(
  'the listener generates {string} for {string}, {int} minutes, and {string}',
  async function (
    this: CustomWorld,
    topic: string,
    audience: string,
    durationMinutes: number,
    style: string,
  ) {
    await this.apiRequest('POST', '/api/podcasts', { topic, audience, durationMinutes, style });
    episode = this.response?.body?.episode as EpisodeResponse;
  },
);

Then('the podcast request succeeds', function (this: CustomWorld) {
  assert.equal(this.response?.status, 201);
});

Then(
  'the episode keeps audience {string}, duration {int}, and style {string}',
  function (audience: string, duration: number, style: string) {
    assert.deepEqual(episode?.controls, { audience, durationMinutes: duration, style });
  },
);

Then('every podcast turn is spoken by alternating host and guest speakers', function () {
  assert.ok(episode?.transcript.length);
  episode?.transcript.forEach((turn, index) => {
    assert.ok(turn.text.trim());
    assert.equal(turn.speaker, index % 2 === 0 ? 'host' : 'guest');
  });
});

Then('no podcast turn exceeds {int} words', function (maximum: number) {
  assert.ok(episode?.transcript.every((turn) => turn.text.trim().split(/\s+/).length <= maximum));
});

Then('the first audio segment is ready', function () {
  assert.equal(episode?.audioSegments[0]?.status, 'ready');
});

Then('later audio preparation is still in progress', function () {
  assert.equal(episode?.generationStatus, 'preparing_audio');
  assert.ok(episode?.audioSegments.slice(1).some((segment) => segment.status === 'pending'));
});

Given('the listener generated a podcast about {string}', async function (this: CustomWorld, topic: string) {
  await this.apiRequest('POST', '/api/podcasts', {
    topic,
    audience: 'Intermediate',
    durationMinutes: 5,
    style: 'Conversational',
  });
  episode = this.response?.body?.episode as EpisodeResponse;
  assert.equal(this.response?.status, 201);
});

When(
  'the listener asks {string} at {int} seconds',
  async function (this: CustomWorld, question: string, playbackPositionSeconds: number) {
    assert.ok(episode?.id);
    await this.apiRequest('POST', `/api/podcasts/${episode.id}/questions`, {
      question,
      playbackPositionSeconds,
    });
  },
);

Then('the intervention starts from {int} seconds', function (this: CustomWorld, seconds: number) {
  assert.equal(this.response?.body?.segment?.playbackPositionSeconds, seconds);
});

Then('the intervention answer is no longer than {int} seconds', function (this: CustomWorld, seconds: number) {
  assert.ok(this.response?.body?.segment?.durationSeconds <= seconds);
});
