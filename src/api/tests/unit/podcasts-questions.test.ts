import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createPodcastService } from '../../src/services/podcast-service.js';
import { clearPodcastEpisodes } from '../../src/models/podcast-store.js';
import { clearUsers } from '../../src/models/user-store.js';

async function registerAndLogin(
  app: ReturnType<typeof createApp>,
  username = 'question_user',
  password = 'SecurePass123!',
) {
  await request(app).post('/api/auth/register').send({ username, password });
  const login = await request(app).post('/api/auth/login').send({ username, password });
  return login.headers['set-cookie'];
}

async function createMockEpisode(
  app: ReturnType<typeof createApp>,
  cookies: string[],
  topic = 'How the universe works',
) {
  const response = await request(app).post('/api/podcasts').set('Cookie', cookies).send({ topic });
  expect(response.status).toBe(201);
  return response.body.episode as { id: string; transcript: Array<{ id: string; text: string }> };
}

describe('POST /api/podcasts/:episodeId/questions', () => {
  beforeEach(() => {
    clearUsers();
    clearPodcastEpisodes();
    delete process.env.PODCAST_PROVIDER;
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
    delete process.env.AZURE_SPEECH_KEY;
    delete process.env.AZURE_SPEECH_REGION;
    delete process.env.AZURE_SPEECH_RESOURCE_ID;
    process.env.REGISTRATION_ENABLED = 'true';
  });

  it('returns 401 when unauthenticated', async () => {
    const app = createApp({ podcastService: createPodcastService() });
    const response = await request(app)
      .post('/api/podcasts/some-episode-id/questions')
      .send({ question: 'hi', playbackPositionSeconds: 0 });

    expect(response.status).toBe(401);
  });

  it('returns 400 when the question is missing or too short', async () => {
    const app = createApp({ podcastService: createPodcastService() });
    const cookies = await registerAndLogin(app);
    const episode = await createMockEpisode(app, cookies);

    const empty = await request(app)
      .post(`/api/podcasts/${episode.id}/questions`)
      .set('Cookie', cookies)
      .send({ question: '', playbackPositionSeconds: 10 });
    expect(empty.status).toBe(400);

    const long = 'x'.repeat(501);
    const overflow = await request(app)
      .post(`/api/podcasts/${episode.id}/questions`)
      .set('Cookie', cookies)
      .send({ question: long, playbackPositionSeconds: 10 });
    expect(overflow.status).toBe(400);
  });

  it('returns 404 for unknown episode', async () => {
    const app = createApp({ podcastService: createPodcastService() });
    const cookies = await registerAndLogin(app);

    const response = await request(app)
      .post('/api/podcasts/does-not-exist/questions')
      .set('Cookie', cookies)
      .send({ question: 'What about black holes?', playbackPositionSeconds: 10 });

    expect(response.status).toBe(404);
  });

  it('produces a host → guest → host segment that includes the question text', async () => {
    const app = createApp({ podcastService: createPodcastService() });
    const cookies = await registerAndLogin(app);
    const episode = await createMockEpisode(app, cookies);

    const question =
      'What happens if I cross the event horizon with one eye only, what do I see';
    const response = await request(app)
      .post(`/api/podcasts/${episode.id}/questions`)
      .set('Cookie', cookies)
      .send({ question, playbackPositionSeconds: 42 });

    expect(response.status).toBe(200);
    const segment = response.body.segment;
    expect(typeof segment.segmentId).toBe('string');
    expect(segment.segmentId.length).toBeGreaterThan(0);
    expect(segment.audioUrl).toBe(
      `/api/podcasts/${episode.id}/segments/${segment.segmentId}/audio`,
    );
    expect(segment.transcript[0].speaker).toBe('host');
    expect(segment.transcript[1].speaker).toBe('guest');
    expect(segment.transcript[segment.transcript.length - 1].speaker).toBe('host');
    expect(segment.transcript[1].text).toContain('event horizon');
    expect(segment.durationSeconds).toBeGreaterThan(0);
  });

  it('streams the steered segment audio to the owner', async () => {
    const app = createApp({ podcastService: createPodcastService() });
    const cookies = await registerAndLogin(app);
    const episode = await createMockEpisode(app, cookies);

    const ask = await request(app)
      .post(`/api/podcasts/${episode.id}/questions`)
      .set('Cookie', cookies)
      .send({ question: 'Tell me about black holes', playbackPositionSeconds: 5 });
    const segmentId = ask.body.segment.segmentId as string;

    const audio = await request(app)
      .get(`/api/podcasts/${episode.id}/segments/${segmentId}/audio`)
      .set('Cookie', cookies);

    expect(audio.status).toBe(200);
    expect(audio.headers['content-type']).toContain('audio/');
    expect(audio.body.length).toBeGreaterThan(0);
  });

  it('returns 404 when another user tries to fetch a segment they do not own', async () => {
    const app = createApp({ podcastService: createPodcastService() });
    const ownerCookies = await registerAndLogin(app);
    const episode = await createMockEpisode(app, ownerCookies);
    const ask = await request(app)
      .post(`/api/podcasts/${episode.id}/questions`)
      .set('Cookie', ownerCookies)
      .send({ question: 'Tell me about black holes', playbackPositionSeconds: 5 });
    const segmentId = ask.body.segment.segmentId as string;

    const otherCookies = await registerAndLogin(app, 'snoop_user', 'OtherPass123!');

    const audio = await request(app)
      .get(`/api/podcasts/${episode.id}/segments/${segmentId}/audio`)
      .set('Cookie', otherCookies);

    expect(audio.status).toBe(404);
  });
});

describe('Steered segment transcript truncation', () => {
  beforeEach(() => {
    clearUsers();
    clearPodcastEpisodes();
    delete process.env.PODCAST_PROVIDER;
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
    delete process.env.AZURE_SPEECH_KEY;
    delete process.env.AZURE_SPEECH_REGION;
    delete process.env.AZURE_SPEECH_RESOURCE_ID;
    process.env.REGISTRATION_ENABLED = 'true';
  });

  it('sliceTranscriptByPlayback respects playback position', async () => {
    const { sliceTranscriptByPlayback } = await import('../../src/services/podcast-service.js');
    const episode = {
      id: 'e1',
      ownerId: 'u1',
      topic: 't',
      title: 't',
      summary: 's',
      createdAt: new Date().toISOString(),
      audioBuffer: Buffer.alloc(0),
      audioContentType: 'audio/wav',
      transcript: [
        // ~5 words → 2.0 s, but clamped to 1.5 s minimum
        { id: '1', speaker: 'host' as const, speakerLabel: 'Host' as const, voice: 'v', text: 'one two three four five' },
        // ~10 words → 4.0 s
        {
          id: '2',
          speaker: 'guest' as const,
          speakerLabel: 'Guest' as const,
          voice: 'v',
          text: 'one two three four five six seven eight nine ten',
        },
        { id: '3', speaker: 'host' as const, speakerLabel: 'Host' as const, voice: 'v', text: 'eleven twelve thirteen fourteen fifteen' },
      ],
    };

    expect(sliceTranscriptByPlayback(episode, 0)).toHaveLength(0);
    expect(sliceTranscriptByPlayback(episode, 1)).toHaveLength(1);
    // After roughly first turn duration but before second's end
    expect(sliceTranscriptByPlayback(episode, 3).length).toBeGreaterThanOrEqual(1);
    expect(sliceTranscriptByPlayback(episode, 100)).toHaveLength(3);
  });
});
