import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createPodcastService } from '../../src/services/podcast-service.js';

const azureEnvironmentKeys = [
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_DEPLOYMENT_NAME',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_REGION',
  'AZURE_SPEECH_RESOURCE_ID',
] as const;

async function authenticatedApp() {
  const app = createApp({ podcastService: createPodcastService() });
  await request(app).post('/api/auth/register').send({
    username: 'provider_user',
    password: 'SecurePass123!',
  });
  const login = await request(app).post('/api/auth/login').send({
    username: 'provider_user',
    password: 'SecurePass123!',
  });
  return { app, cookies: login.headers['set-cookie'] };
}

describe('podcast provider selection', () => {
  afterEach(() => {
    delete process.env.PODCAST_PROVIDER;
    for (const key of azureEnvironmentKeys) delete process.env[key];
  });

  it('reports mock and real provider availability without exposing credentials', async () => {
    process.env.PODCAST_PROVIDER = 'mock';
    process.env.AZURE_OPENAI_API_KEY = 'secret-openai-key';
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME = 'gpt-4.1';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://example.openai.azure.com';
    process.env.AZURE_SPEECH_KEY = 'secret-speech-key';
    process.env.AZURE_SPEECH_REGION = 'eastus';
    const { app, cookies } = await authenticatedApp();

    const response = await request(app).get('/api/podcasts/providers').set('Cookie', cookies);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      defaultProvider: 'mock',
      providers: {
        mock: { available: true, label: 'Mock audio (testing only)' },
        azure: {
          available: true,
          label: 'Real podcast (Azure AI Foundry)',
          model: 'gpt-4.1',
        },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('uses the explicitly selected mock provider', async () => {
    process.env.PODCAST_PROVIDER = 'mock';
    const { app, cookies } = await authenticatedApp();

    const response = await request(app)
      .post('/api/podcasts')
      .set('Cookie', cookies)
      .send({ topic: 'History of Boeing', provider: 'mock' });

    expect(response.status).toBe(201);
    expect(response.body.episode.provider).toBe('mock');
  });

  it('returns an actionable error when real generation is not configured', async () => {
    process.env.PODCAST_PROVIDER = 'mock';
    const { app, cookies } = await authenticatedApp();

    const response = await request(app)
      .post('/api/podcasts')
      .set('Cookie', cookies)
      .send({ topic: 'History of Boeing', provider: 'azure' });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/not configured/i);
  });
});
