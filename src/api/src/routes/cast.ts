import type { Express, Request, Response } from 'express';
import {
  type CastService,
  CastNotFoundError,
  CastValidationError,
} from '../services/cast-service.js';
import { listAzureChatDeployments } from '../services/cast-service-azure.js';
import { logger } from '../logger.js';

// Hardcoded fallback list — used when Azure auth isn't wired up so the UI
// still has something to show. Mirrors what's deployed in `crgar-liliput-ai`.
const FALLBACK_CHAT_MODELS = [
  { deployment: 'gpt-5', model: 'gpt-5', chatCapable: true },
  { deployment: 'gpt-5-mini', model: 'gpt-5-mini', chatCapable: true },
] as const;

export function mapCastEndpoints(app: Express, service: CastService): void {
  // List the chat-capable Azure OpenAI deployments visible to this pod.
  // Used to populate the "Model" dropdown on the start screen so the
  // listener picks from real deployments instead of typing a name and
  // hoping it exists. Cached for 60s so a quick rerender doesn't hammer
  // Azure with /openai/deployments calls.
  let cachedModels: { items: Array<{ deployment: string; model: string }>; defaultDeployment: string; expiresAt: number } | null = null;
  app.get('/api/cast/models', async (_req: Request, res: Response) => {
    const now = Date.now();
    if (cachedModels && cachedModels.expiresAt > now) {
      res.status(200).json({
        models: cachedModels.items,
        defaultDeployment: cachedModels.defaultDeployment,
        source: 'cache',
      });
      return;
    }

    let models: Array<{ deployment: string; model: string }> = [];
    let source: 'azure' | 'fallback' = 'fallback';
    try {
      const fetched = await listAzureChatDeployments();
      if (fetched && fetched.length > 0) {
        models = fetched.filter((m) => m.chatCapable).map((m) => ({ deployment: m.deployment, model: m.model }));
        source = 'azure';
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '/api/cast/models: live deployment listing failed; using fallback',
      );
    }
    if (models.length === 0) {
      models = FALLBACK_CHAT_MODELS.map((m) => ({ deployment: m.deployment, model: m.model }));
      source = 'fallback';
    }
    const defaultDeployment =
      process.env.AZURE_OPENAI_DEPLOYMENT_NAME?.trim() || models[0]?.deployment || 'gpt-5';

    // Sort gpt-5 first, then gpt-5-mini, then the rest alphabetically — the
    // "best" model is what most users want as the default visual.
    models.sort((a, b) => {
      const rank = (n: string) => {
        if (n === 'gpt-5') return 0;
        if (n === 'gpt-5-mini') return 1;
        if (/^gpt-4o/.test(n)) return 2;
        if (/^gpt-4/.test(n)) return 3;
        return 9;
      };
      const ar = rank(a.deployment);
      const br = rank(b.deployment);
      if (ar !== br) return ar - br;
      return a.deployment.localeCompare(b.deployment);
    });

    cachedModels = { items: models, defaultDeployment, expiresAt: now + 60_000 };
    res.status(200).json({ models, defaultDeployment, source });
  });

  // Create a new cast session for a topic. Anonymous — no auth required.
  app.post('/api/cast', (req: Request, res: Response) => {
    try {
      const { topic, style, systemPrompt, model } = (req.body ?? {}) as {
        topic?: unknown;
        style?: unknown;
        systemPrompt?: unknown;
        model?: unknown;
      };
      const session = service.startSession(typeof topic === 'string' ? topic : '', {
        style: typeof style === 'string' ? style : undefined,
        systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : undefined,
        model: typeof model === 'string' ? model : undefined,
      });
      const meta = service.getMeta(session.id);
      res.status(201).json({
        id: session.id,
        topic: session.topic,
        style: session.style,
        createdAt: session.createdAt,
        provider: meta?.provider,
        modelDisplayName: meta?.modelDisplayName,
        systemPrompt: meta?.systemPrompt,
        systemPromptIsOverride: meta?.systemPromptIsOverride ?? false,
        modelIsOverride: meta?.modelIsOverride ?? false,
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
      for await (const segment of service.generateStream(sessionId, controller.signal, since)) {
        if (controller.signal.aborted) break;
        res.write(`event: segment\ndata: ${JSON.stringify(segment)}\n\n`);
      }
      if (!controller.signal.aborted) {
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
