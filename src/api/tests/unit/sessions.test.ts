import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { clearSessions } from '../../src/models/session-store.js';

// Helper to register + login and return a cookie-bearing supertest agent
async function authenticatedAgent() {
  const app = createApp();
  const agent = request.agent(app);

  await agent
    .post('/api/auth/register')
    .send({ username: 'testuser', password: 'password123' });

  await agent
    .post('/api/auth/login')
    .send({ username: 'testuser', password: 'password123' });

  return { agent, app };
}

describe('Interactive Sessions API', () => {
  beforeEach(() => {
    clearSessions();
  });

  describe('POST /api/podcasts/sessions', () => {
    it('creates a session with segments from a topic', async () => {
      const { agent } = await authenticatedAgent();

      const res = await agent
        .post('/api/podcasts/sessions')
        .send({ topic: 'artificial intelligence' });

      expect(res.status).toBe(201);
      expect(res.body.session).toBeDefined();
      expect(res.body.session.topic).toBe('artificial intelligence');
      expect(res.body.session.segments.length).toBeGreaterThanOrEqual(2);
      expect(res.body.session.status).toBe('ready');
      expect(res.body.session.revision).toBe(0);
      expect(res.body.session.interrupts).toEqual([]);

      // Each segment has expected shape
      const seg = res.body.session.segments[0];
      expect(seg.id).toBeDefined();
      expect(seg.hostLine).toBeDefined();
      expect(seg.guestLine).toBeDefined();
      expect(seg.status).toBe('ready');
      expect(seg.audioUrl).toContain('/audio');
    });

    it('returns 400 for empty topic', async () => {
      const { agent } = await authenticatedAgent();
      const res = await agent.post('/api/podcasts/sessions').send({ topic: '' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing topic', async () => {
      const { agent } = await authenticatedAgent();
      const res = await agent.post('/api/podcasts/sessions').send({});
      expect(res.status).toBe(400);
    });

    it('returns 401 for unauthenticated request', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/podcasts/sessions')
        .send({ topic: 'test' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/podcasts/sessions', () => {
    it('lists sessions for the authenticated user', async () => {
      const { agent } = await authenticatedAgent();

      await agent.post('/api/podcasts/sessions').send({ topic: 'topic one' });
      await agent.post('/api/podcasts/sessions').send({ topic: 'topic two' });

      const res = await agent.get('/api/podcasts/sessions');
      expect(res.status).toBe(200);
      expect(res.body.sessions.length).toBe(2);
      expect(res.body.sessions[0].topic).toBe('topic two'); // most recent first
      expect(res.body.sessions[0].segmentCount).toBeGreaterThanOrEqual(2);
    });

    it('returns empty array when no sessions exist', async () => {
      const { agent } = await authenticatedAgent();
      const res = await agent.get('/api/podcasts/sessions');
      expect(res.status).toBe(200);
      expect(res.body.sessions).toEqual([]);
    });
  });

  describe('GET /api/podcasts/sessions/:sessionId', () => {
    it('returns full session with segments and interrupts', async () => {
      const { agent } = await authenticatedAgent();

      const createRes = await agent
        .post('/api/podcasts/sessions')
        .send({ topic: 'quantum computing' });
      const sessionId = createRes.body.session.id;

      const res = await agent.get(`/api/podcasts/sessions/${sessionId}`);
      expect(res.status).toBe(200);
      expect(res.body.session.id).toBe(sessionId);
      expect(res.body.session.segments.length).toBeGreaterThanOrEqual(2);
    });

    it('returns 404 for non-existent session', async () => {
      const { agent } = await authenticatedAgent();
      const res = await agent.get('/api/podcasts/sessions/nonexistent-id');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/podcasts/sessions/:sessionId', () => {
    it('deletes a session', async () => {
      const { agent } = await authenticatedAgent();

      const createRes = await agent
        .post('/api/podcasts/sessions')
        .send({ topic: 'to be deleted' });
      const sessionId = createRes.body.session.id;

      const delRes = await agent.delete(`/api/podcasts/sessions/${sessionId}`);
      expect(delRes.status).toBe(200);

      const getRes = await agent.get(`/api/podcasts/sessions/${sessionId}`);
      expect(getRes.status).toBe(404);
    });

    it('returns 404 for non-existent session', async () => {
      const { agent } = await authenticatedAgent();
      const res = await agent.delete('/api/podcasts/sessions/nonexistent-id');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/podcasts/sessions/:sessionId/segments/:segmentId/audio', () => {
    it('returns audio bytes for a segment', async () => {
      const { agent } = await authenticatedAgent();

      const createRes = await agent
        .post('/api/podcasts/sessions')
        .send({ topic: 'audio test' });
      const session = createRes.body.session;
      const segmentId = session.segments[0].id;

      const res = await agent.get(
        `/api/podcasts/sessions/${session.id}/segments/${segmentId}/audio`,
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('audio');
      expect(res.body.length).toBeGreaterThan(44); // WAV header + some data
    });

    it('returns 404 for non-existent segment', async () => {
      const { agent } = await authenticatedAgent();

      const createRes = await agent
        .post('/api/podcasts/sessions')
        .send({ topic: 'audio test' });
      const session = createRes.body.session;

      const res = await agent.get(
        `/api/podcasts/sessions/${session.id}/segments/nonexistent/audio`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/podcasts/sessions/:sessionId/interrupt', () => {
    it('processes an interrupt and returns updated session', async () => {
      const { agent } = await authenticatedAgent();

      const createRes = await agent
        .post('/api/podcasts/sessions')
        .send({ topic: 'machine learning' });
      const session = createRes.body.session;
      const lastSegment = session.segments[session.segments.length - 1];

      const res = await agent
        .post(`/api/podcasts/sessions/${session.id}/interrupt`)
        .send({
          questionText: 'What about deep learning specifically?',
          inputMethod: 'text',
          afterSegmentId: lastSegment.id,
          clientRequestId: 'req-001',
        });

      expect(res.status).toBe(200);
      expect(res.body.session.revision).toBe(1);
      expect(res.body.session.interrupts.length).toBe(1);
      expect(res.body.session.interrupts[0].questionText).toBe(
        'What about deep learning specifically?',
      );
      // Should have more segments than before
      expect(res.body.session.segments.length).toBeGreaterThan(session.segments.length);
    });

    it('returns 400 for missing questionText', async () => {
      const { agent } = await authenticatedAgent();

      const createRes = await agent
        .post('/api/podcasts/sessions')
        .send({ topic: 'test' });
      const session = createRes.body.session;

      const res = await agent
        .post(`/api/podcasts/sessions/${session.id}/interrupt`)
        .send({
          inputMethod: 'text',
          afterSegmentId: session.segments[0].id,
          clientRequestId: 'req-001',
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 for too-short questionText', async () => {
      const { agent } = await authenticatedAgent();

      const createRes = await agent
        .post('/api/podcasts/sessions')
        .send({ topic: 'test' });
      const session = createRes.body.session;

      const res = await agent
        .post(`/api/podcasts/sessions/${session.id}/interrupt`)
        .send({
          questionText: 'Hi',
          inputMethod: 'text',
          afterSegmentId: session.segments[0].id,
          clientRequestId: 'req-001',
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid inputMethod', async () => {
      const { agent } = await authenticatedAgent();

      const createRes = await agent
        .post('/api/podcasts/sessions')
        .send({ topic: 'test' });
      const session = createRes.body.session;

      const res = await agent
        .post(`/api/podcasts/sessions/${session.id}/interrupt`)
        .send({
          questionText: 'A valid question here',
          inputMethod: 'invalid',
          afterSegmentId: session.segments[0].id,
          clientRequestId: 'req-001',
        });

      expect(res.status).toBe(400);
    });

    it('supports idempotent retries with same clientRequestId', async () => {
      const { agent } = await authenticatedAgent();

      const createRes = await agent
        .post('/api/podcasts/sessions')
        .send({ topic: 'idempotency test' });
      const session = createRes.body.session;
      const lastSegment = session.segments[session.segments.length - 1];

      const payload = {
        questionText: 'Is this idempotent?',
        inputMethod: 'text' as const,
        afterSegmentId: lastSegment.id,
        clientRequestId: 'req-idempotent',
      };

      // First call
      const res1 = await agent
        .post(`/api/podcasts/sessions/${session.id}/interrupt`)
        .send(payload);
      expect(res1.status).toBe(200);

      // Second call with same clientRequestId should not create duplicate
      const res2 = await agent
        .post(`/api/podcasts/sessions/${session.id}/interrupt`)
        .send(payload);
      expect(res2.status).toBe(200);
      expect(res2.body.session.interrupts.length).toBe(1);
    });

    it('returns 404 for non-existent session', async () => {
      const { agent } = await authenticatedAgent();

      const res = await agent
        .post('/api/podcasts/sessions/nonexistent/interrupt')
        .send({
          questionText: 'Does this work?',
          inputMethod: 'text',
          afterSegmentId: 'some-id',
          clientRequestId: 'req-001',
        });

      expect(res.status).toBe(404);
    });

    it('marks stale segments after interrupt at midpoint', async () => {
      const { agent } = await authenticatedAgent();

      const createRes = await agent
        .post('/api/podcasts/sessions')
        .send({ topic: 'stale test' });
      const session = createRes.body.session;
      const firstSegment = session.segments[0];

      const res = await agent
        .post(`/api/podcasts/sessions/${session.id}/interrupt`)
        .send({
          questionText: 'Let me redirect the conversation',
          inputMethod: 'text',
          afterSegmentId: firstSegment.id,
          clientRequestId: 'req-stale',
        });

      expect(res.status).toBe(200);
      // Active segments should include the first segment + new interrupt segments
      // but not the original segments after the first
      const activeSegments = res.body.session.segments;
      expect(activeSegments[0].id).toBe(firstSegment.id);
      // New segments should be marked as generated after interrupt
      const newSegs = activeSegments.filter(
        (s: { generatedAfterInterrupt: string | undefined }) => s.generatedAfterInterrupt,
      );
      expect(newSegs.length).toBeGreaterThan(0);
    });
  });
});
