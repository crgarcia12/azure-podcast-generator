import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { clearSessions } from '../../src/models/session-store.js';

async function authenticatedAgent() {
  const app = createApp();
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ username: 'chatuser', password: 'password123' });
  await agent.post('/api/auth/login').send({ username: 'chatuser', password: 'password123' });
  return { agent, app };
}

describe('Chat Endpoints', () => {
  beforeEach(() => {
    clearSessions();
  });

  describe('Legacy /api/chat/* endpoints', () => {
    it('POST /api/chat/sessions returns 410 Gone', async () => {
      const app = createApp();
      const res = await request(app).post('/api/chat/sessions');
      expect(res.status).toBe(410);
    });
  });

  describe('GET /api/podcasts/sessions/:sessionId/chat', () => {
    it('returns empty chat for new session', async () => {
      const { agent } = await authenticatedAgent();
      const sessionRes = await agent.post('/api/podcasts/sessions').send({ topic: 'chat test' });
      const sessionId = sessionRes.body.session.id;

      const res = await agent.get(`/api/podcasts/sessions/${sessionId}/chat`);
      expect(res.status).toBe(200);
      expect(res.body.messages).toEqual([]);
    });

    it('returns 404 for non-existent session', async () => {
      const { agent } = await authenticatedAgent();
      const res = await agent.get('/api/podcasts/sessions/nonexistent/chat');
      expect(res.status).toBe(404);
    });

    it('requires authentication', async () => {
      const app = createApp();
      const res = await request(app).get('/api/podcasts/sessions/some-id/chat');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/podcasts/sessions/:sessionId/chat', () => {
    it('creates chat message and triggers interrupt', async () => {
      const { agent } = await authenticatedAgent();
      const sessionRes = await agent.post('/api/podcasts/sessions').send({ topic: 'chat edit test' });
      const session = sessionRes.body.session;
      const firstSegment = session.segments[0];

      const res = await agent
        .post(`/api/podcasts/sessions/${session.id}/chat`)
        .send({
          message: 'Can we talk more about the early history?',
          afterSegmentId: firstSegment.id,
          clientRequestId: crypto.randomUUID(),
        });

      expect(res.status).toBe(200);
      expect(res.body.session).toBeDefined();
      expect(res.body.chatMessages).toHaveLength(2);
      expect(res.body.chatMessages[0].role).toBe('user');
      expect(res.body.chatMessages[1].role).toBe('assistant');
    });

    it('validates message is required', async () => {
      const { agent } = await authenticatedAgent();
      const sessionRes = await agent.post('/api/podcasts/sessions').send({ topic: 'test' });
      const session = sessionRes.body.session;

      const res = await agent
        .post(`/api/podcasts/sessions/${session.id}/chat`)
        .send({ afterSegmentId: session.segments[0].id, clientRequestId: 'abc' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('message is required');
    });

    it('persists chat messages across requests', async () => {
      const { agent } = await authenticatedAgent();
      const sessionRes = await agent.post('/api/podcasts/sessions').send({ topic: 'persistence test' });
      const session = sessionRes.body.session;

      await agent
        .post(`/api/podcasts/sessions/${session.id}/chat`)
        .send({
          message: 'First question about history',
          afterSegmentId: session.segments[0].id,
          clientRequestId: crypto.randomUUID(),
        });

      const chatRes = await agent.get(`/api/podcasts/sessions/${session.id}/chat`);
      expect(chatRes.body.messages.length).toBeGreaterThanOrEqual(2);
      expect(chatRes.body.messages[0].role).toBe('user');
    });
  });
});
