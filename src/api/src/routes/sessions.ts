import { type Express } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';
import {
  type InteractiveSessionService,
  SessionNotFoundError,
} from '../services/interactive-session-service.js';
import {
  SessionLimitError,
  InterruptConflictError,
  SegmentNotFoundError,
  SESSION_LIMITS,
  getActiveSegments,
  type PodcastSession,
  type PodcastSegment,
} from '../models/session-store.js';
import { PODCAST_TOPIC_MAX_LENGTH } from '../services/podcast-service.js';

// ─── Response Types ──────────────────────────────────────────────────

interface SegmentResponse {
  id: string;
  index: number;
  hostLine: string;
  guestLine: string;
  status: string;
  revision: number;
  generatedAfterInterrupt?: string;
  audioUrl: string;
}

interface InterruptResponse {
  id: string;
  afterSegmentId: string;
  questionText: string;
  inputMethod: 'voice' | 'text';
  createdAt: string;
}

interface SessionResponse {
  id: string;
  topic: string;
  title: string;
  summary: string;
  revision: number;
  status: string;
  segments: SegmentResponse[];
  interrupts: InterruptResponse[];
  createdAt: string;
  updatedAt: string;
}

// ─── Route Mapping ───────────────────────────────────────────────────

function paramStr(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

export function mapSessionEndpoints(
  app: Express,
  sessionService: InteractiveSessionService,
): void {
  // List sessions
  app.get('/api/podcasts/sessions', authMiddleware, async (req, res) => {
    try {
      const summaries = sessionService.listSessions({ userId: req.user!.sub });
      res.json({ sessions: summaries });
    } catch (error) {
      logger.error({ err: error, userId: req.user?.sub }, 'Failed to list sessions');
      res.status(500).json({ error: 'Unable to load sessions right now' });
    }
  });

  // Create session
  app.post('/api/podcasts/sessions', authMiddleware, async (req, res) => {
    const topic = parseTopic(req.body);
    if (!topic) {
      res.status(400).json({ error: 'Topic is required' });
      return;
    }

    if (topic.length > PODCAST_TOPIC_MAX_LENGTH) {
      res.status(400).json({
        error: `Topic must be ${PODCAST_TOPIC_MAX_LENGTH} characters or fewer`,
      });
      return;
    }

    try {
      const session = await sessionService.createSession({
        userId: req.user!.sub,
        topic,
      });

      res.status(201).json({ session: toSessionResponse(session) });
    } catch (error) {
      if (error instanceof SessionLimitError) {
        res.status(429).json({ error: error.message });
        return;
      }
      logger.error({ err: error, userId: req.user?.sub }, 'Failed to create session');
      res.status(500).json({ error: 'Unable to create session right now' });
    }
  });

  // Get session
  app.get('/api/podcasts/sessions/:sessionId', authMiddleware, async (req, res) => {
    try {
      const session = sessionService.getSession({
        sessionId: paramStr(req.params.sessionId),
        userId: req.user!.sub,
      });

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({ session: toSessionResponse(session) });
    } catch (error) {
      logger.error({ err: error, userId: req.user?.sub }, 'Failed to get session');
      res.status(500).json({ error: 'Unable to load session right now' });
    }
  });

  // Delete session
  app.delete('/api/podcasts/sessions/:sessionId', authMiddleware, async (req, res) => {
    try {
      const deleted = sessionService.deleteSession({
        sessionId: paramStr(req.params.sessionId),
        userId: req.user!.sub,
      });

      if (!deleted) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({ message: 'Session deleted' });
    } catch (error) {
      logger.error({ err: error, userId: req.user?.sub }, 'Failed to delete session');
      res.status(500).json({ error: 'Unable to delete session right now' });
    }
  });

  // Get segment audio
  app.get(
    '/api/podcasts/sessions/:sessionId/segments/:segmentId/audio',
    authMiddleware,
    async (req, res) => {
      try {
        const audio = await sessionService.getSegmentAudio({
          sessionId: paramStr(req.params.sessionId),
          segmentId: paramStr(req.params.segmentId),
          userId: req.user!.sub,
        });

        if (!audio) {
          res.status(404).json({ error: 'Segment audio not found' });
          return;
        }

        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', audio.length.toString());
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.send(audio);
      } catch (error) {
        logger.error({ err: error, userId: req.user?.sub }, 'Failed to get segment audio');
        res.status(500).json({ error: 'Unable to generate audio right now' });
      }
    },
  );

  // Interrupt
  app.post(
    '/api/podcasts/sessions/:sessionId/interrupt',
    authMiddleware,
    async (req, res) => {
      const { questionText, inputMethod, afterSegmentId, clientRequestId } = req.body ?? {};

      // Validate inputs
      if (typeof questionText !== 'string' || questionText.trim().length === 0) {
        res.status(400).json({ error: 'questionText is required' });
        return;
      }

      const trimmedQuestion = questionText.trim();
      if (trimmedQuestion.length < SESSION_LIMITS.questionMinLength) {
        res.status(400).json({
          error: `Question must be at least ${SESSION_LIMITS.questionMinLength} characters`,
        });
        return;
      }

      if (trimmedQuestion.length > SESSION_LIMITS.questionMaxLength) {
        res.status(400).json({
          error: `Question must be ${SESSION_LIMITS.questionMaxLength} characters or fewer`,
        });
        return;
      }

      if (!['voice', 'text'].includes(inputMethod)) {
        res.status(400).json({ error: 'inputMethod must be "voice" or "text"' });
        return;
      }

      if (typeof afterSegmentId !== 'string' || !afterSegmentId) {
        res.status(400).json({ error: 'afterSegmentId is required' });
        return;
      }

      if (typeof clientRequestId !== 'string' || !clientRequestId) {
        res.status(400).json({ error: 'clientRequestId is required' });
        return;
      }

      try {
        const result = await sessionService.processInterrupt({
          sessionId: paramStr(req.params.sessionId),
          userId: req.user!.sub,
          questionText: trimmedQuestion,
          inputMethod,
          afterSegmentId,
          clientRequestId,
        });

        res.json({ session: toSessionResponse(result.session) });
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          res.status(404).json({ error: error.message });
          return;
        }
        if (error instanceof InterruptConflictError) {
          res.status(409).json({ error: error.message });
          return;
        }
        if (error instanceof SegmentNotFoundError) {
          res.status(400).json({ error: error.message });
          return;
        }
        if (error instanceof SessionLimitError) {
          res.status(429).json({ error: error.message });
          return;
        }

        logger.error(
          { err: error, sessionId: paramStr(req.params.sessionId), userId: req.user?.sub },
          'Interrupt processing failed',
        );
        res.status(500).json({ error: 'Unable to process interrupt right now' });
      }
    },
  );

  // Test-only: clear sessions for e2e isolation
  if (process.env.NODE_ENV !== 'production') {
    app.post('/api/test/reset-sessions', (_req, res) => {
      const { clearSessions } = require('../models/session-store.js') as typeof import('../models/session-store.js');
      clearSessions();
      res.json({ message: 'Sessions cleared' });
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parseTopic(body: Record<string, unknown>): string | null {
  if (typeof body?.topic !== 'string') {
    return null;
  }
  const topic = body.topic.trim();
  return topic.length > 0 ? topic : null;
}

function toSessionResponse(session: PodcastSession): SessionResponse {
  const activeSegments = getActiveSegments(session);

  return {
    id: session.id,
    topic: session.topic,
    title: session.title,
    summary: session.summary,
    revision: session.revision,
    status: session.status,
    segments: activeSegments.map((seg) => toSegmentResponse(session.id, seg)),
    interrupts: session.interrupts.map(toInterruptResponse),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function toSegmentResponse(sessionId: string, segment: PodcastSegment): SegmentResponse {
  return {
    id: segment.id,
    index: segment.index,
    hostLine: segment.hostLine,
    guestLine: segment.guestLine,
    status: segment.status,
    revision: segment.revision,
    generatedAfterInterrupt: segment.generatedAfterInterrupt,
    audioUrl: `/api/podcasts/sessions/${sessionId}/segments/${segment.id}/audio`,
  };
}

function toInterruptResponse(interrupt: { id: string; afterSegmentId: string; questionText: string; inputMethod: 'voice' | 'text'; createdAt: string }): InterruptResponse {
  return {
    id: interrupt.id,
    afterSegmentId: interrupt.afterSegmentId,
    questionText: interrupt.questionText,
    inputMethod: interrupt.inputMethod,
    createdAt: interrupt.createdAt,
  };
}
