import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  PodcastDependencyError,
  type PodcastEpisodeDraft,
  type PodcastService,
  type StoredPodcastEpisode,
} from '../../src/services/podcast-service.js';

function createFakePodcastService(
  options: {
    failWithDraft?: boolean;
  } = {},
): PodcastService {
  const episodes = new Map<string, StoredPodcastEpisode>();

  return {
    async createEpisode({ ownerId, topic }) {
      const draftEpisode: PodcastEpisodeDraft = {
        id: 'podcast-episode-1',
        ownerId,
        topic,
        title: `${topic} in Conversation`,
        summary: `Interview-style podcast about ${topic}.`,
        createdAt: new Date('2026-04-13T22:12:36Z').toISOString(),
        transcript: [
          {
            id: 'turn-1',
            speaker: 'host',
            speakerLabel: 'Host',
            voice: 'en-US-JennyNeural',
            text: `Welcome to our episode about ${topic}.`,
          },
          {
            id: 'turn-2',
            speaker: 'guest',
            speakerLabel: 'Guest',
            voice: 'en-US-GuyNeural',
            text: `${topic} is a fascinating story with major turning points.`,
          },
        ],
      };

      if (options.failWithDraft) {
        throw new PodcastDependencyError(
          'Audio generation failed. The script is ready, but speech synthesis is currently unavailable.',
          draftEpisode,
        );
      }

      const storedEpisode: StoredPodcastEpisode = {
        ...draftEpisode,
        audioBuffer: Buffer.from('RIFFmock-audio'),
        audioContentType: 'audio/wav',
      };
      episodes.set(storedEpisode.id, storedEpisode);
      return storedEpisode;
    },
    async getEpisodeById({ episodeId, ownerId }) {
      const episode = episodes.get(episodeId);
      return episode && episode.ownerId === ownerId ? episode : null;
    },
  };
}

async function registerAndLogin(app: ReturnType<typeof createApp>) {
  await request(app)
    .post('/api/auth/register')
    .send({ username: 'podcast_user', password: 'SecurePass123!' });

  const loginResponse = await request(app)
    .post('/api/auth/login')
    .send({ username: 'podcast_user', password: 'SecurePass123!' });

  return loginResponse.headers['set-cookie'];
}

describe('Podcast Endpoints', () => {
  it('POST /api/podcasts should require authentication', async () => {
    const app = createApp({ podcastService: createFakePodcastService() });

    const response = await request(app)
      .post('/api/podcasts')
      .send({ topic: 'History of Boeing' });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Not authenticated');
  });

  it('POST /api/podcasts should validate the topic', async () => {
    const app = createApp({ podcastService: createFakePodcastService() });
    const cookies = await registerAndLogin(app);

    const response = await request(app)
      .post('/api/podcasts')
      .set('Cookie', cookies)
      .send({ topic: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Topic is required');
  });

  it('POST /api/podcasts should create an episode with transcript and audio url', async () => {
    const app = createApp({ podcastService: createFakePodcastService() });
    const cookies = await registerAndLogin(app);

    const response = await request(app)
      .post('/api/podcasts')
      .set('Cookie', cookies)
      .send({ topic: 'History of Boeing' });

    expect(response.status).toBe(201);
    expect(response.body.episode.title).toContain('History of Boeing');
    expect(response.body.episode.audioAvailable).toBe(true);
    expect(response.body.episode.audioUrl).toBe('/api/podcasts/podcast-episode-1/audio');
    expect(response.body.episode.transcript).toHaveLength(2);
  });

  it('POST /api/podcasts should return the draft script when audio generation fails', async () => {
    const app = createApp({ podcastService: createFakePodcastService({ failWithDraft: true }) });
    const cookies = await registerAndLogin(app);

    const response = await request(app)
      .post('/api/podcasts')
      .set('Cookie', cookies)
      .send({ topic: 'History of Boeing' });

    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(/audio generation failed/i);
    expect(response.body.draftEpisode.audioAvailable).toBe(false);
    expect(response.body.draftEpisode.transcript).toHaveLength(2);
  });

  it('GET /api/podcasts/:id/audio should stream audio for the episode owner', async () => {
    const app = createApp({ podcastService: createFakePodcastService() });
    const cookies = await registerAndLogin(app);

    await request(app)
      .post('/api/podcasts')
      .set('Cookie', cookies)
      .send({ topic: 'History of Boeing' });

    const audioResponse = await request(app)
      .get('/api/podcasts/podcast-episode-1/audio')
      .set('Cookie', cookies);

    expect(audioResponse.status).toBe(200);
    expect(audioResponse.headers['content-type']).toContain('audio/wav');
    expect(audioResponse.body.length).toBeGreaterThan(0);
  });
});
