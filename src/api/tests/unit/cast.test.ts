import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

// Override the per-segment pacing for tests so the SSE stream finishes fast.
process.env.CAST_SEGMENT_PACE_MS = '0';

interface ParsedEvent {
  event: string;
  data: unknown;
}

function parseEvents(body: string): ParsedEvent[] {
  return body
    .split(/\n\n+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && !chunk.startsWith(':'))
    .map((chunk) => {
      const lines = chunk.split('\n');
      let event = 'message';
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      const raw = dataLines.join('\n');
      let data: unknown = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        // leave as string
      }
      return { event, data };
    });
}

describe('cast endpoints', () => {
  describe('POST /api/cast', () => {
    it('creates a session for a valid topic without requiring auth', async () => {
      const app = createApp();
      const res = await request(app).post('/api/cast').send({ topic: 'the moon landing' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        topic: 'the moon landing',
        createdAt: expect.any(String),
      });
    });

    it('rejects missing topic with 400', async () => {
      const app = createApp();
      const res = await request(app).post('/api/cast').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/topic/i);
    });

    it('rejects topic over 200 chars with 400', async () => {
      const app = createApp();
      const longTopic = 'a'.repeat(201);
      const res = await request(app).post('/api/cast').send({ topic: longTopic });
      expect(res.status).toBe(400);
    });

    it('trims whitespace and collapses internal spaces', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/cast')
        .send({ topic: '   formula   one    racing   ' });
      expect(res.status).toBe(201);
      expect(res.body.topic).toBe('formula one racing');
    });
  });

  describe('GET /api/cast/:id/stream', () => {
    it('returns 404 for unknown session id', async () => {
      const app = createApp();
      const res = await request(app).get('/api/cast/00000000-0000-0000-0000-000000000000/stream');
      expect(res.status).toBe(404);
    });

    it('streams segments via SSE and ends with done', async () => {
      const app = createApp();
      const create = await request(app).post('/api/cast').send({ topic: 'jazz history' });
      const sessionId = create.body.id as string;

      const res = await request(app)
        .get(`/api/cast/${sessionId}/stream`)
        .buffer(true)
        .parse((response, callback) => {
          let data = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            data += chunk;
          });
          response.on('end', () => callback(null, data));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/event-stream/);

      const body = res.body as unknown as string;
      const events = parseEvents(body);
      expect(events.length).toBeGreaterThan(5);

      const helloEvent = events[0];
      expect(helloEvent.event).toBe('hello');
      expect(helloEvent.data).toMatchObject({ id: sessionId, topic: 'jazz history' });

      const segmentEvents = events.filter((e) => e.event === 'segment');
      expect(segmentEvents.length).toBeGreaterThanOrEqual(20);

      // Speakers alternate within a beat: host, guest, host, guest, ...
      for (let i = 0; i < segmentEvents.length; i += 2) {
        const seg = segmentEvents[i].data as { speaker: string; index: number };
        expect(seg.speaker).toBe('host');
        expect(seg.index).toBe(i);
      }

      // Topic appears somewhere in the script
      const allText = segmentEvents.map((e) => (e.data as { text: string }).text).join(' ');
      expect(allText.toLowerCase()).toContain('jazz history');

      // Ends cleanly
      expect(events.at(-1)?.event).toBe('done');
    });
  });

  describe('POST /api/cast/:id/question', () => {
    it('returns 404 for unknown session id', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/cast/00000000-0000-0000-0000-000000000000/question')
        .send({ question: 'What about jazz?' });
      expect(res.status).toBe(404);
    });

    it('rejects empty question with 400', async () => {
      const app = createApp();
      const create = await request(app).post('/api/cast').send({ topic: 'cycling' });
      const res = await request(app).post(`/api/cast/${create.body.id}/question`).send({ question: '   ' });
      expect(res.status).toBe(400);
    });

    it('queues a question and influences the next streamed segment', async () => {
      const app = createApp();
      const create = await request(app).post('/api/cast').send({ topic: 'cycling' });
      const sessionId = create.body.id as string;

      // Inject a question BEFORE we start streaming so it gets pulled first.
      await request(app)
        .post(`/api/cast/${sessionId}/question`)
        .send({ question: 'How did the modern road bike evolve?' });

      const res = await request(app)
        .get(`/api/cast/${sessionId}/stream`)
        .buffer(true)
        .parse((response, callback) => {
          let data = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            data += chunk;
          });
          response.on('end', () => callback(null, data));
        });

      const events = parseEvents(res.body as unknown as string);
      const segments = events.filter((e) => e.event === 'segment').map((e) => e.data as { speaker: string; text: string });

      // The first beat must reference the listener's question.
      const allText = segments.map((s) => s.text).join(' ');
      expect(allText.toLowerCase()).toContain('listener');
      expect(allText.toLowerCase()).toContain('modern road bike');
    });
  });
});
