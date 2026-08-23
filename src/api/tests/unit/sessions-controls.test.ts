import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { clearSessions } from '../../src/models/session-store.js';
import { clearUsers } from '../../src/models/user-store.js';
import { buildAzureEpisodeSystemPrompt } from '../../src/services/interactive-session-service.js';

async function authenticatedAgent(username = 'ctrl_user') {
  const app = createApp();
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ username, password: 'password123' });
  await agent.post('/api/auth/login').send({ username, password: 'password123' });
  return { agent, app };
}

describe('POST /api/podcasts/sessions — controls', () => {
  beforeEach(() => {
    clearUsers();
    clearSessions();
  });

  it('applies default controls when none specified', async () => {
    const { agent } = await authenticatedAgent();
    const res = await agent.post('/api/podcasts/sessions').send({ topic: 'quantum computing' });

    expect(res.status).toBe(201);
    expect(res.body.session.controls).toEqual({
      audienceLevel: 'intermediate',
      durationMinutes: 10,
      conversationStyle: 'conversational',
    });
    expect(res.body.session.generationState).toBe('preparing-audio');
    expect(res.body.session.estimatedDurationMinutes).toBe(10);
  });

  it('accepts valid controls and reflects them in response', async () => {
    const { agent } = await authenticatedAgent('ctrl_user2');
    const res = await agent.post('/api/podcasts/sessions').send({
      topic: 'machine learning',
      audienceLevel: 'expert',
      durationMinutes: 5,
      conversationStyle: 'debate',
    });

    expect(res.status).toBe(201);
    expect(res.body.session.controls.audienceLevel).toBe('expert');
    expect(res.body.session.controls.durationMinutes).toBe(5);
    expect(res.body.session.controls.conversationStyle).toBe('debate');
    expect(res.body.session.estimatedDurationMinutes).toBe(5);
  });

  it('returns 400 with INVALID_PODCAST_CONTROL code for invalid audienceLevel', async () => {
    const { agent } = await authenticatedAgent('ctrl_user3');
    const res = await agent.post('/api/podcasts/sessions').send({
      topic: 'test',
      audienceLevel: 'genius',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PODCAST_CONTROL');
    expect(res.body.field).toBe('audienceLevel');
    expect(typeof res.body.message).toBe('string');
  });

  it('returns 400 with INVALID_PODCAST_CONTROL code for invalid durationMinutes', async () => {
    const { agent } = await authenticatedAgent('ctrl_user4');
    const res = await agent.post('/api/podcasts/sessions').send({
      topic: 'test',
      durationMinutes: 7,
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PODCAST_CONTROL');
    expect(res.body.field).toBe('durationMinutes');
  });

  it('returns 400 with INVALID_PODCAST_CONTROL code for invalid conversationStyle', async () => {
    const { agent } = await authenticatedAgent('ctrl_user5');
    const res = await agent.post('/api/podcasts/sessions').send({
      topic: 'test',
      conversationStyle: 'aggressive',
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PODCAST_CONTROL');
    expect(res.body.field).toBe('conversationStyle');
  });

  it('returns controls and transcript in session response', async () => {
    const { agent } = await authenticatedAgent('ctrl_user6');
    const res = await agent.post('/api/podcasts/sessions').send({
      topic: 'climate change',
      audienceLevel: 'beginner',
      durationMinutes: 5,
      conversationStyle: 'educational',
    });

    expect(res.status).toBe(201);
    const session = res.body.session;

    // Transcript must be present and alternating
    expect(Array.isArray(session.transcript)).toBe(true);
    expect(session.transcript.length).toBeGreaterThan(0);
    expect(session.transcript[0].speaker).toBe('host');
    expect(session.transcript[1].speaker).toBe('guest');
    for (let i = 0; i < session.transcript.length; i++) {
      expect(session.transcript[i].text.trim().length).toBeGreaterThan(0);
      expect(session.transcript[i].speaker).toBe(i % 2 === 0 ? 'host' : 'guest');
    }

    // Segments must have turns field
    expect(Array.isArray(session.segments)).toBe(true);
    expect(session.segments[0].turns).toBeDefined();
    expect(session.segments[0].turns.length).toBe(2);
  });

  it('first segment is ready and subsequent segments are pending', async () => {
    const { agent } = await authenticatedAgent('ctrl_user7');
    const res = await agent.post('/api/podcasts/sessions').send({
      topic: 'blockchain',
      durationMinutes: 10,
    });

    expect(res.status).toBe(201);
    const session = res.body.session;
    expect(session.segments.length).toBeGreaterThan(1);

    // First segment must be ready
    expect(session.segments[0].status).toBe('ready');
    // At least one subsequent segment must be pending
    const laterStatuses = session.segments.slice(1).map((s: { status: string }) => s.status);
    expect(laterStatuses.some((s: string) => s === 'pending')).toBe(true);
  });

  it('audio endpoint works for first (ready) segment', async () => {
    const { agent } = await authenticatedAgent('ctrl_user8');
    const createRes = await agent.post('/api/podcasts/sessions').send({ topic: 'space exploration' });
    const session = createRes.body.session;
    const firstSeg = session.segments[0];

    const audioRes = await agent.get(`/api/podcasts/sessions/${session.id}/segments/${firstSeg.id}/audio`);
    expect(audioRes.status).toBe(200);
    expect(audioRes.headers['content-type']).toContain('audio');
  });

  it('audio endpoint synthesizes on-demand for pending segments', async () => {
    const { agent } = await authenticatedAgent('ctrl_user9');
    const createRes = await agent.post('/api/podcasts/sessions').send({ topic: 'history of aviation' });
    const session = createRes.body.session;
    const pendingSegs = session.segments.filter((s: { status: string }) => s.status === 'pending');
    expect(pendingSegs.length).toBeGreaterThan(0);

    const audioRes = await agent.get(
      `/api/podcasts/sessions/${session.id}/segments/${pendingSegs[0].id}/audio`,
    );
    expect(audioRes.status).toBe(200);
    expect(audioRes.headers['content-type']).toContain('audio');
  });
});

describe('Azure episode prompt', () => {
  it('requests a concrete, responsive narrative with enough short turns for the duration', () => {
    const prompt = buildAzureEpisodeSystemPrompt({
      audienceLevel: 'beginner',
      durationMinutes: 10,
      conversationStyle: 'conversational',
    });

    expect(prompt).toContain('at least 18 short, strictly alternating host and guest turns');
    expect(prompt).toContain('Build a clear narrative arc');
    expect(prompt).toContain('specific follow-ups');
    expect(prompt).toContain('concrete names, dates, mechanisms, comparisons, and consequences');
    expect(prompt).toContain('Use plain language');
    expect(prompt).toContain('warm and conversational');
  });
});

describe('POST /api/podcasts/sessions — production provider enforcement', () => {
  beforeEach(() => {
    clearUsers();
    clearSessions();
  });

  it('returns 503 in production when PODCAST_PROVIDER is not azure', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalProvider = process.env.PODCAST_PROVIDER;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.PODCAST_PROVIDER;

      const app = createApp();
      const agent = request.agent(app);
      await agent.post('/api/auth/register').send({ username: 'prod_user', password: 'password123' });
      await agent.post('/api/auth/login').send({ username: 'prod_user', password: 'password123' });

      const res = await agent.post('/api/podcasts/sessions').send({ topic: 'test' });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('PROVIDER_UNAVAILABLE');
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalProvider !== undefined) {
        process.env.PODCAST_PROVIDER = originalProvider;
      } else {
        delete process.env.PODCAST_PROVIDER;
      }
    }
  });
});

describe('POST /api/podcasts/sessions/:sessionId/interventions', () => {
  beforeEach(() => {
    clearUsers();
    clearSessions();
  });

  it('creates an intervention with text input and returns intervention object', async () => {
    const { agent } = await authenticatedAgent('iv_user1');
    const createRes = await agent.post('/api/podcasts/sessions').send({ topic: 'evolution' });
    const session = createRes.body.session;

    const res = await agent
      .post(`/api/podcasts/sessions/${session.id}/interventions`)
      .send({
        questionText: 'What is the significance of natural selection?',
        afterSegmentId: session.segments[0].id,
        clientRequestId: 'iv-req-001',
        playbackPositionSeconds: 30,
      });

    expect(res.status).toBe(200);
    expect(res.body.intervention).toBeDefined();
    const iv = res.body.intervention;
    expect(typeof iv.id).toBe('string');
    expect(iv.state).toBe('ready');
    expect(iv.capturedPositionSeconds).toBe(30);
    expect(typeof iv.answerText).toBe('string');
    expect(iv.answerAudioUrl).toContain('/interventions/');
    expect(iv.answerAudioUrl).toContain('/audio');
  });

  it('rejects voice input with 400', async () => {
    const { agent } = await authenticatedAgent('iv_user2');
    const createRes = await agent.post('/api/podcasts/sessions').send({ topic: 'physics' });
    const session = createRes.body.session;

    const res = await agent
      .post(`/api/podcasts/sessions/${session.id}/interventions`)
      .send({
        questionText: 'What is dark matter?',
        afterSegmentId: session.segments[0].id,
        clientRequestId: 'iv-req-voice',
        playbackPositionSeconds: 0,
        inputMethod: 'voice',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/voice/i);
  });

  it('returns 400 for missing questionText', async () => {
    const { agent } = await authenticatedAgent('iv_user3');
    const createRes = await agent.post('/api/podcasts/sessions').send({ topic: 'chemistry' });
    const session = createRes.body.session;

    const res = await agent
      .post(`/api/podcasts/sessions/${session.id}/interventions`)
      .send({
        afterSegmentId: session.segments[0].id,
        clientRequestId: 'iv-req-003',
        playbackPositionSeconds: 0,
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid playbackPositionSeconds', async () => {
    const { agent } = await authenticatedAgent('iv_user4');
    const createRes = await agent.post('/api/podcasts/sessions').send({ topic: 'biology' });
    const session = createRes.body.session;

    const res = await agent
      .post(`/api/podcasts/sessions/${session.id}/interventions`)
      .send({
        questionText: 'Tell me about cells',
        afterSegmentId: session.segments[0].id,
        clientRequestId: 'iv-req-004',
        playbackPositionSeconds: -1,
      });

    expect(res.status).toBe(400);
  });

  it('does NOT stale existing episode segments after intervention', async () => {
    const { agent } = await authenticatedAgent('iv_user5');
    const createRes = await agent.post('/api/podcasts/sessions').send({ topic: 'ecology' });
    const session = createRes.body.session;
    const originalSegmentCount = session.segments.length;

    await agent
      .post(`/api/podcasts/sessions/${session.id}/interventions`)
      .send({
        questionText: 'What is biodiversity and why does it matter?',
        afterSegmentId: session.segments[0].id,
        clientRequestId: 'iv-req-005',
        playbackPositionSeconds: 45,
      });

    // Session segments should be unchanged
    const getRes = await agent.get(`/api/podcasts/sessions/${session.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.session.segments.length).toBe(originalSegmentCount);
  });

  it('preserves the episode when intervention generation fails', async () => {
    const originalFailure = process.env.MOCK_INTERVENTION_FAILURE;
    process.env.MOCK_INTERVENTION_FAILURE = 'true';
    try {
      const { agent } = await authenticatedAgent('iv_failure_user');
      const createRes = await agent.post('/api/podcasts/sessions').send({ topic: 'jet engines' });
      const session = createRes.body.session;

      const res = await agent
        .post(`/api/podcasts/sessions/${session.id}/interventions`)
        .send({
          questionText: 'Why did jet engines matter?',
          afterSegmentId: session.segments[0].id,
          clientRequestId: 'iv-failure-001',
          playbackPositionSeconds: 42,
        });

      expect(res.status).toBe(200);
      expect(res.body.intervention.state).toBe('failed');
      expect(res.body.intervention.capturedPositionSeconds).toBe(42);

      const getRes = await agent.get(`/api/podcasts/sessions/${session.id}`);
      expect(getRes.body.session.segments).toHaveLength(session.segments.length);
    } finally {
      if (originalFailure === undefined) delete process.env.MOCK_INTERVENTION_FAILURE;
      else process.env.MOCK_INTERVENTION_FAILURE = originalFailure;
    }
  });

  it('supports idempotent retries via clientRequestId', async () => {
    const { agent } = await authenticatedAgent('iv_user6');
    const createRes = await agent.post('/api/podcasts/sessions').send({ topic: 'geology' });
    const session = createRes.body.session;

    const payload = {
      questionText: 'How are mountains formed?',
      afterSegmentId: session.segments[0].id,
      clientRequestId: 'iv-idempotent',
      playbackPositionSeconds: 10,
    };

    const res1 = await agent.post(`/api/podcasts/sessions/${session.id}/interventions`).send(payload);
    expect(res1.status).toBe(200);
    const id1 = res1.body.intervention.id;

    const res2 = await agent.post(`/api/podcasts/sessions/${session.id}/interventions`).send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.intervention.id).toBe(id1);
  });

  it('returns 404 for non-existent session', async () => {
    const { agent } = await authenticatedAgent('iv_user7');
    const res = await agent
      .post('/api/podcasts/sessions/non-existent-id/interventions')
      .send({
        questionText: 'Some question here?',
        afterSegmentId: 'some-segment',
        clientRequestId: 'req-007',
        playbackPositionSeconds: 0,
      });

    expect(res.status).toBe(404);
  });

  it('ownership: another user cannot POST to someone else\'s session', async () => {
    const { agent: agent1 } = await authenticatedAgent('iv_owner');
    const { agent: agent2 } = await authenticatedAgent('iv_intruder');

    const createRes = await agent1.post('/api/podcasts/sessions').send({ topic: 'botany' });
    const session = createRes.body.session;

    const res = await agent2
      .post(`/api/podcasts/sessions/${session.id}/interventions`)
      .send({
        questionText: 'What is photosynthesis exactly?',
        afterSegmentId: session.segments[0].id,
        clientRequestId: 'iv-intruder-req',
        playbackPositionSeconds: 0,
      });

    expect(res.status).toBe(404);
  });
});

describe('GET intervention audio', () => {
  beforeEach(() => {
    clearUsers();
    clearSessions();
  });

  it('returns audio for a ready intervention', async () => {
    const { agent } = await authenticatedAgent('audio_iv_user');
    const createRes = await agent.post('/api/podcasts/sessions').send({ topic: 'astronomy' });
    const session = createRes.body.session;

    const ivRes = await agent
      .post(`/api/podcasts/sessions/${session.id}/interventions`)
      .send({
        questionText: 'What are neutron stars?',
        afterSegmentId: session.segments[0].id,
        clientRequestId: 'audio-iv-001',
        playbackPositionSeconds: 60,
      });

    expect(ivRes.status).toBe(200);
    const audioUrl = ivRes.body.intervention.answerAudioUrl;

    const audioRes = await agent.get(audioUrl);
    expect(audioRes.status).toBe(200);
    expect(audioRes.headers['content-type']).toContain('audio');
    expect(audioRes.body.length).toBeGreaterThan(44);
  });

  it('returns 404 for non-existent intervention audio', async () => {
    const { agent } = await authenticatedAgent('audio_iv_user2');
    const createRes = await agent.post('/api/podcasts/sessions').send({ topic: 'neuroscience' });
    const session = createRes.body.session;

    const res = await agent.get(
      `/api/podcasts/sessions/${session.id}/interventions/nonexistent-id/audio`,
    );
    expect(res.status).toBe(404);
  });
});
