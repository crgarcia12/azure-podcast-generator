import type { Express, Request, Response } from 'express';
import {
  type CastService,
  CastNotFoundError,
  CastValidationError,
} from '../services/cast-service.js';
import { logger } from '../logger.js';

export function mapCastEndpoints(app: Express, service: CastService): void {
  // Create a new cast session for a topic. Anonymous — no auth required.
  app.post('/api/cast', async (req: Request, res: Response) => {
    try {
      const { topic, style, targetDurationMinutes } = (req.body ?? {}) as {
        topic?: unknown;
        style?: unknown;
        targetDurationMinutes?: unknown;
      };
      const session = service.startSession(typeof topic === 'string' ? topic : '', {
        style: typeof style === 'string' ? style : undefined,
        targetDurationMinutes:
          typeof targetDurationMinutes === 'number' ? targetDurationMinutes : undefined,
      });
      const firstBatch = await service.generateNextBatch(session.id);
      const meta = service.getMeta(session.id);
      const progress = service.getProgress(session.id);
      res.status(201).json({
        id: session.id,
        topic: session.topic,
        style: session.style,
        createdAt: session.createdAt,
        provider: meta?.provider,
        modelDisplayName: meta?.modelDisplayName,
        systemPrompt: meta?.systemPrompt,
        firstBatch,
        progress,
      });
    } catch (err) {
      if (err instanceof CastValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      logger.error({ err }, 'Failed to start cast session');
      res.status(500).json({ error: 'Failed to start cast session' });
    }
  });

  app.get('/api/cast/:id/progress', (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const progress = service.getProgress(sessionId);
    if (!progress) {
      res.status(404).json({ error: 'Cast session not found' });
      return;
    }
    res.status(200).json(progress);
  });

  app.get('/api/cast/:id/batches/:sequence', (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const rawSequence = Array.isArray(req.params.sequence)
      ? req.params.sequence[0]
      : req.params.sequence;
    const sequence = Number.parseInt(rawSequence, 10);
    const batch = Number.isFinite(sequence) ? service.getBatch(sessionId, sequence) : undefined;
    if (!batch) {
      res.status(404).json({ error: 'Podcast batch not found' });
      return;
    }
    res.status(200).json({ batch });
  });

  app.post('/api/cast/:id/stop', (req: Request, res: Response) => {
    try {
      const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      res.status(200).json(service.stopSession(sessionId));
    } catch (error) {
      if (error instanceof CastNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  app.post('/api/cast/:id/retry', (req: Request, res: Response) => {
    try {
      const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      res.status(200).json(service.retrySession(sessionId));
    } catch (error) {
      if (error instanceof CastNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  // Inspect the metadata for a session — including the would-be LLM system
  // prompt. Surfaced for transparency: the user asked "what prompt and model
  // are you using" and they deserve a real answer they can read.
  app.get('/api/cast/:id/meta', (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const meta = service.getMeta(sessionId);
    if (!meta) {
      res.status(404).json({ error: 'Cast session not found' });
      return;
    }
    res.status(200).json(meta);
  });

  // SSE — server-sent events stream of cast segments. Each event:
  //   event: segment
  //   data: {"index":0,"speaker":"host","text":"..."}
  // Closes with `event: done` when the host finishes the wrap-up beat.
  app.get('/api/cast/:id/stream', async (req: Request, res: Response) => {
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const session = service.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Cast session not found' });
      return;
    }

    // `?since=N` lets a reconnecting client skip segments it has already heard
    // — used after the listener submits a question so the show resumes
    // forward instead of replaying from the start.
    const rawSince = Array.isArray(req.query.since) ? req.query.since[0] : req.query.since;
    const since = (() => {
      const n = Number.parseInt(typeof rawSince === 'string' ? rawSince : '', 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    })();

    const controller = new AbortController();
    res.on('close', () => controller.abort());
    res.on('error', () => controller.abort());

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Initial hello so curl-style probes see the session metadata immediately.
    res.write(`event: hello\ndata: ${JSON.stringify({ id: session.id, topic: session.topic })}\n\n`);

    // Heartbeat every 15s so long-lived connections through proxies don't time out.
    const heartbeat = setInterval(() => {
      if (controller.signal.aborted) return;
      try {
        res.write(`: ping\n\n`);
      } catch {
        controller.abort();
      }
    }, 15_000);

    try {
      let lastBatchSequence = 0;
      for await (const segment of service.generateStream(sessionId, controller.signal, since)) {
        if (controller.signal.aborted) break;
        if (segment.batchSequence && segment.batchSequence !== lastBatchSequence) {
          lastBatchSequence = segment.batchSequence;
          const batch = service.getBatch(sessionId, segment.batchSequence);
          if (batch) {
            res.write(`event: batch\ndata: ${JSON.stringify(batch)}\n\n`);
          }
          res.write(`event: progress\ndata: ${JSON.stringify(service.getProgress(sessionId))}\n\n`);
        }
        res.write(`event: segment\ndata: ${JSON.stringify(segment)}\n\n`);
      }
      if (!controller.signal.aborted) {
        res.write(`event: progress\ndata: ${JSON.stringify(service.getProgress(sessionId))}\n\n`);
        res.write(`event: done\ndata: {}\n\n`);
      }
    } catch (err) {
      logger.error({ err, sessionId }, 'Cast stream error');
      if (!controller.signal.aborted) {
        try {
          res.write(`event: error\ndata: ${JSON.stringify({ message: 'stream error' })}\n\n`);
        } catch {
          /* ignore */
        }
      }
    } finally {
      clearInterval(heartbeat);
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  });

  // Inject a listener question into the session. Returns 202; the next
  // segments emitted by the SSE stream will be the answer.
  app.post('/api/cast/:id/question', (req: Request, res: Response) => {
    try {
      const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { question } = (req.body ?? {}) as { question?: unknown };
      const result = service.addQuestion(sessionId, typeof question === 'string' ? question : '');
      res.status(202).json(result);
    } catch (err) {
      if (err instanceof CastNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof CastValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      logger.error({ err }, 'Failed to add cast question');
      res.status(500).json({ error: 'Failed to add cast question' });
    }
  });
}
