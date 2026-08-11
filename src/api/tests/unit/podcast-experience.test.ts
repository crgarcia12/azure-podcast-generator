import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  PODCAST_TURN_MAX_WORDS,
  PodcastDependencyError,
  createPodcastService,
  validatePodcastScript,
} from '../../src/services/podcast-service.js';

async function authenticatedApp() {
  const app = createApp({ podcastService: createPodcastService() });
  await request(app).post('/api/auth/register').send({
    username: 'experience_user',
    password: 'SecurePass123!',
  });
  const login = await request(app).post('/api/auth/login').send({
    username: 'experience_user',
    password: 'SecurePass123!',
  });
  return { app, cookies: login.headers['set-cookie'] };
}

describe('adaptive podcast experience', () => {
  beforeEach(() => {
    process.env.PODCAST_PROVIDER = 'mock';
    delete process.env.MOCK_INTERVENTION_FAIL;
  });

  it('applies defaults and exposes the first segment while later audio is pending', async () => {
    const { app, cookies } = await authenticatedApp();
    const response = await request(app)
      .post('/api/podcasts')
      .set('Cookie', cookies)
      .send({ topic: 'History of Boeing' });

    expect(response.status).toBe(201);
    expect(response.body.episode.controls).toEqual({
      audience: 'Intermediate',
      durationMinutes: 5,
      style: 'Conversational',
    });
    expect(response.body.episode.generationStatus).toBe('preparing_audio');
    expect(response.body.episode.audioSegments[0].status).toBe('ready');
    expect(response.body.episode.audioSegments.some(
      (segment: { status: string }) => segment.status === 'pending',
    )).toBe(true);
  });

  it('persists supported controls and generates validated alternating dialogue', async () => {
    const { app, cookies } = await authenticatedApp();
    const response = await request(app)
      .post('/api/podcasts')
      .set('Cookie', cookies)
      .send({
        topic: 'History of Boeing',
        audience: 'Beginner',
        durationMinutes: 5,
        style: 'Conversational',
      });

    expect(response.status).toBe(201);
    expect(response.body.episode.controls.audience).toBe('Beginner');
    const turns = response.body.episode.transcript as Array<{ speaker: string; text: string }>;
    expect(turns.some((turn) => turn.speaker === 'host')).toBe(true);
    expect(turns.some((turn) => turn.speaker === 'guest')).toBe(true);
    expect(turns.every((turn) => turn.text.trim().split(/\s+/).length <= PODCAST_TURN_MAX_WORDS)).toBe(true);
  });

  it.each([
    { audience: 'Child', durationMinutes: 5, style: 'Conversational' },
    { audience: 'Beginner', durationMinutes: 30, style: 'Conversational' },
    { audience: 'Beginner', durationMinutes: 5, style: 'Monologue' },
  ])('rejects unsupported controls: %j', async (controls) => {
    const { app, cookies } = await authenticatedApp();
    const response = await request(app)
      .post('/api/podcasts')
      .set('Cookie', cookies)
      .send({ topic: 'History of Boeing', ...controls });
    expect(response.status).toBe(400);
  });

  it('rejects empty, overlong, and single-speaker transcripts', () => {
    expect(() => validatePodcastScript([
      { speaker: 'host', text: 'Only one speaker.' },
    ], 5)).toThrow(PodcastDependencyError);
    expect(() => validatePodcastScript([
      { speaker: 'host', text: 'Hello.' },
      { speaker: 'guest', text: '' },
    ], 5)).toThrow(/empty turn/i);
    expect(() => validatePodcastScript([
      { speaker: 'host', text: 'Hello.' },
      { speaker: 'guest', text: Array(81).fill('word').join(' ') },
    ], 5)).toThrow(/80 words/i);
  });

  it('returns a concise topic-aware answer and preserves the interruption position', async () => {
    const { app, cookies } = await authenticatedApp();
    const episode = await request(app)
      .post('/api/podcasts')
      .set('Cookie', cookies)
      .send({ topic: 'History of Boeing' });
    const response = await request(app)
      .post(`/api/podcasts/${episode.body.episode.id}/questions`)
      .set('Cookie', cookies)
      .send({ question: 'Why did jet engines matter?', playbackPositionSeconds: 60 });

    expect(response.status).toBe(200);
    expect(response.body.segment.playbackPositionSeconds).toBe(60);
    expect(response.body.segment.durationSeconds).toBeGreaterThanOrEqual(2);
    expect(response.body.segment.durationSeconds).toBeLessThanOrEqual(45);
    expect(response.body.segment.transcript[1].text).toContain('History of Boeing');
    expect(response.body.segment.transcript[1].text).not.toContain('black hole');
  });
});
