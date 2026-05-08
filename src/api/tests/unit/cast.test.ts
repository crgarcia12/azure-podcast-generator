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
  describe('GET /api/cast/models', () => {
    it('returns the fallback model list when Azure is not configured', async () => {
      const prev = process.env.LLM_PROVIDER;
      delete process.env.LLM_PROVIDER;
      try {
        const app = createApp();
        const res = await request(app).get('/api/cast/models');
        expect(res.status).toBe(200);
        expect(res.body.source).toBe('fallback');
        expect(Array.isArray(res.body.models)).toBe(true);
        expect(res.body.models.length).toBeGreaterThan(0);
        const deployments = res.body.models.map((m: { deployment: string }) => m.deployment);
        expect(deployments).toContain('gpt-5');
        expect(deployments).toContain('gpt-5-mini');
        expect(typeof res.body.defaultDeployment).toBe('string');
      } finally {
        if (prev !== undefined) process.env.LLM_PROVIDER = prev;
      }
    });

    it('places gpt-5 ahead of gpt-5-mini in the response', async () => {
      const prev = process.env.LLM_PROVIDER;
      delete process.env.LLM_PROVIDER;
      try {
        const app = createApp();
        const res = await request(app).get('/api/cast/models');
        expect(res.status).toBe(200);
        const deployments: string[] = res.body.models.map((m: { deployment: string }) => m.deployment);
        const gpt5Idx = deployments.indexOf('gpt-5');
        const miniIdx = deployments.indexOf('gpt-5-mini');
        expect(gpt5Idx).toBeGreaterThanOrEqual(0);
        expect(miniIdx).toBeGreaterThan(gpt5Idx);
      } finally {
        if (prev !== undefined) process.env.LLM_PROVIDER = prev;
      }
    });

    it('also exposes an `allDeployments` array with chatCapable + kind metadata', async () => {
      const prev = process.env.LLM_PROVIDER;
      delete process.env.LLM_PROVIDER;
      try {
        const app = createApp();
        const res = await request(app).get('/api/cast/models');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.allDeployments)).toBe(true);
        expect(res.body.allDeployments.length).toBeGreaterThan(0);
        for (const m of res.body.allDeployments) {
          expect(typeof m.deployment).toBe('string');
          expect(typeof m.model).toBe('string');
          expect(typeof m.chatCapable).toBe('boolean');
          expect(['chat', 'transcription', 'tts', 'embedding', 'image', 'other']).toContain(m.kind);
          expect(typeof m.reason).toBe('string');
        }
        // Fallback list is chat-only — every entry must be chatCapable.
        for (const m of res.body.allDeployments) {
          expect(m.chatCapable).toBe(true);
        }
      } finally {
        if (prev !== undefined) process.env.LLM_PROVIDER = prev;
      }
    });
  });

  describe('GET /api/cast/prompt-template', () => {
    it('returns the default system-prompt template with placeholders', async () => {
      const app = createApp();
      const res = await request(app).get('/api/cast/prompt-template');
      expect(res.status).toBe(200);
      expect(typeof res.body.template).toBe('string');
      expect(res.body.template).toContain('{{topic}}');
      expect(res.body.template).toContain('{{styleClause}}');
      expect(typeof res.body.styleClause).toBe('string');
      expect(res.body.styleClause).toContain('{{style}}');
      expect(Array.isArray(res.body.placeholders)).toBe(true);
      expect(res.body.placeholders).toContain('{{topic}}');
      expect(res.body.placeholders).toContain('{{style}}');
      expect(typeof res.body.example?.rendered).toBe('string');
      // The rendered example is a quick eyeball check that the template
      // interpolates correctly server-side with no leftover placeholders.
      expect(res.body.example.rendered).not.toContain('{{');
      expect(res.body.example.rendered).toContain(res.body.example.topic);
    });
  });

  describe('default-prompt round-trip', () => {
    it('treats a posted-back default prompt as "no override"', async () => {
      const app = createApp();
      const tplRes = await request(app).get('/api/cast/prompt-template');
      expect(tplRes.status).toBe(200);
      const template = tplRes.body.template as string;
      const styleClause = tplRes.body.styleClause as string;
      const topic = 'jazz history';
      const style = 'sleepy bedtime story';
      const renderedDefault = template
        .replace('{{topic}}', topic)
        .replace('{{styleClause}}', styleClause.replace('{{style}}', style));

      const create = await request(app).post('/api/cast').send({
        topic,
        style,
        // Sending the rendered default verbatim should NOT mark the session
        // as a prompt override — the server normalises this so /meta still
        // says "(default)".
        systemPrompt: renderedDefault,
      });
      expect(create.status).toBe(201);
      const sessionId = create.body.id as string;

      const meta = await request(app).get(`/api/cast/${sessionId}/meta`);
      expect(meta.status).toBe(200);
      expect(meta.body.systemPrompt).toBe(renderedDefault);
      expect(meta.body.systemPromptIsOverride).toBe(false);
    });

    it('treats a *modified* default as a real override', async () => {
      const app = createApp();
      const tplRes = await request(app).get('/api/cast/prompt-template');
      const template = tplRes.body.template as string;
      const renderedDefault = template
        .replace('{{topic}}', 'rome')
        .replace('{{styleClause}}', '');
      const tweaked = `${renderedDefault} Add a closing limerick.`;

      const create = await request(app)
        .post('/api/cast')
        .send({ topic: 'rome', systemPrompt: tweaked });
      expect(create.status).toBe(201);
      const sessionId = create.body.id as string;

      const meta = await request(app).get(`/api/cast/${sessionId}/meta`);
      expect(meta.status).toBe(200);
      expect(meta.body.systemPromptIsOverride).toBe(true);
      expect(meta.body.systemPrompt).toBe(tweaked);
    });
  });

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

    it('accepts a custom style and threads it into the system prompt', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/cast')
        .send({ topic: 'rome', style: 'punchy and contrarian' });
      expect(res.status).toBe(201);
      expect(res.body.style).toBe('punchy and contrarian');
      expect(res.body.provider).toBe('mock-template');
      expect(res.body.modelDisplayName).toMatch(/PodCraft/i);
      expect(res.body.systemPrompt).toContain('rome');
      expect(res.body.systemPrompt).toContain('punchy and contrarian');
    });

    it('rejects style longer than 500 chars with 400', async () => {
      const app = createApp();
      const longStyle = 'x'.repeat(501);
      const res = await request(app)
        .post('/api/cast')
        .send({ topic: 'rome', style: longStyle });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/cast/:id/meta', () => {
    it('returns the would-be system prompt and provider info', async () => {
      const app = createApp();
      const create = await request(app)
        .post('/api/cast')
        .send({ topic: 'jazz history', style: 'sleepy bedtime story' });
      const sessionId = create.body.id as string;

      const res = await request(app).get(`/api/cast/${sessionId}/meta`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: sessionId,
        topic: 'jazz history',
        style: 'sleepy bedtime story',
        provider: 'mock-template',
        modelDisplayName: expect.stringMatching(/PodCraft/i),
        systemPrompt: expect.stringContaining('jazz history'),
      });
      expect(res.body.systemPrompt).toContain('sleepy bedtime story');
    });

    it('returns 404 for unknown session id', async () => {
      const app = createApp();
      const res = await request(app).get('/api/cast/00000000-0000-0000-0000-000000000000/meta');
      expect(res.status).toBe(404);
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

    it('answers with a multi-beat exchange that quotes the question text verbatim', async () => {
      const app = createApp();
      const create = await request(app).post('/api/cast').send({ topic: 'rome' });
      const sessionId = create.body.id as string;

      await request(app)
        .post(`/api/cast/${sessionId}/question`)
        .send({ question: 'Why did the western empire really collapse?' });

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
      const segments = events
        .filter((e) => e.event === 'segment')
        .map((e) => e.data as { speaker: string; text: string; index: number });

      // The listener question must be quoted verbatim in the host's setup line —
      // proving the answer is genuinely about THIS question, not a generic stock answer.
      expect(segments[0].speaker).toBe('host');
      expect(segments[0].text).toContain('Why did the western empire really collapse');

      // The answer is a multi-beat exchange (≥3 beats / 6 segments) before resuming the outline.
      // Find where outline content starts (the outline opener mentions "Welcome back to the show").
      const outlineStart = segments.findIndex((s) => s.text.includes('Welcome back to the show'));
      expect(outlineStart).toBeGreaterThanOrEqual(6);
    });
  });

  describe('GET /api/cast/:id/stream?since=N', () => {
    it('skips already-heard segments when reconnecting', async () => {
      const app = createApp();
      const create = await request(app).post('/api/cast').send({ topic: 'mars exploration' });
      const sessionId = create.body.id as string;

      // First connection: fully drain the stream (so all segments are persisted in the session).
      await request(app)
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

      // Inject a question — the next reconnect should jump straight to the answer.
      await request(app)
        .post(`/api/cast/${sessionId}/question`)
        .send({ question: 'When will humans set foot on Mars?' });

      // Reconnect with `since=1000` (well past any historical index) — only the
      // newly-emitted answer segments (indexed >= 1000? no — only segments whose
      // index is >= since). With since=1000 and current segments < 100, NO old
      // segments should replay, only fresh answer segments will arrive.
      const res = await request(app)
        .get(`/api/cast/${sessionId}/stream?since=1000`)
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
      const segments = events
        .filter((e) => e.event === 'segment')
        .map((e) => e.data as { speaker: string; text: string; index: number });

      // Every emitted segment is the answer to the listener question — no replay
      // of the original outline.
      expect(segments.length).toBeGreaterThan(0);
      const allText = segments.map((s) => s.text).join(' ');
      expect(allText.toLowerCase()).toContain('listener');
      expect(allText).toContain('When will humans set foot on Mars');
      // No outline opener — that line lives in already-heard segments and `since`
      // skipped it.
      expect(allText.includes('Welcome back to the show')).toBe(false);
    });
  });
});
