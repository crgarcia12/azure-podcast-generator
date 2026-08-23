import { type Express } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { logger } from '../logger.js';
import {
  type InteractiveSessionService,
  SessionNotFoundError,
  ProviderUnavailableError,
  ProviderGenerationError,
} from '../services/interactive-session-service.js';
import {
  SessionLimitError,
  InterruptConflictError,
  SegmentNotFoundError,
  SESSION_LIMITS,
  getActiveSegments,
  updateSessionProgress,
  toggleSessionFavorite,
  type PodcastSession,
  type PodcastSegment,
  type PodcastGenerationControls,
  type PodcastGenerationState,
  type PodcastAudienceLevel,
  type PodcastDurationMinutes,
  type PodcastConversationStyle,
} from '../models/session-store.js';
import { PODCAST_TOPIC_MAX_LENGTH } from '../services/podcast-service.js';
import { getChatMessages, addChatMessage } from '../models/chat-store.js';
import { emitTelemetry } from '../services/telemetry.js';

// ─── Valid control values ─────────────────────────────────────────────

const VALID_AUDIENCE_LEVELS: PodcastAudienceLevel[] = ['beginner', 'intermediate', 'expert'];
const VALID_DURATION_MINUTES: PodcastDurationMinutes[] = [5, 10, 15];
const VALID_CONVERSATION_STYLES: PodcastConversationStyle[] = ['conversational', 'educational', 'debate'];

const DEFAULT_CONTROLS: PodcastGenerationControls = {
  audienceLevel: 'intermediate',
  durationMinutes: 10,
  conversationStyle: 'conversational',
};

// ─── Response Types ──────────────────────────────────────────────────

interface TranscriptTurnResponse {
  speaker: 'host' | 'guest';
  text: string;
}

interface SegmentResponse {
  id: string;
  index: number;
  hostLine: string;
  guestLine: string;
  turns: TranscriptTurnResponse[];
  status: string;
  audioStatus: string;
  revision: number;
  generatedAfterInterrupt?: string;
  audioUrl: string;
  errorCode?: string;
}

interface InterruptResponse {
  id: string;
  afterSegmentId: string;
  questionText: string;
  inputMethod: 'voice' | 'text';
  createdAt: string;
}

interface InterventionResponse {
  id: string;
  state: string;
  capturedPositionSeconds: number;
  answerText?: string;
  answerAudioUrl?: string;
  errorCode?: string;
}

interface SessionResponse {
  id: string;
  topic: string;
  title: string;
  summary: string;
  revision: number;
  status: string;
  controls: PodcastGenerationControls;
  generationState: PodcastGenerationState;
  estimatedDurationMinutes: number;
  transcript: TranscriptTurnResponse[];
  lastSegmentIndex: number;
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

  // Create session — enhanced with controls
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

    // Parse and validate controls
    const controlsResult = parseControls(req.body);
    if (!controlsResult.ok) {
      res.status(400).json({
        error: controlsResult.error,
        code: 'INVALID_PODCAST_CONTROL',
        field: controlsResult.field,
        message: controlsResult.error,
      });
      return;
    }

    try {
      const session = await sessionService.createSession({
        userId: req.user!.sub,
        topic,
        controls: controlsResult.controls,
      });

      res.status(201).json({ session: toSessionResponse(session) });
    } catch (error) {
      if (error instanceof SessionLimitError) {
        res.status(429).json({ error: error.message });
        return;
      }
      if (error instanceof ProviderUnavailableError) {
        res.status(503).json({ error: error.message, code: 'PROVIDER_UNAVAILABLE' });
        return;
      }
      if (error instanceof ProviderGenerationError) {
        res.status(502).json({ error: error.message, code: error.code });
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

      const chatMessages = getChatMessages(session.id);
      res.json({ session: toSessionResponse(session), chatMessages });
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

  // Update session progress
  app.patch('/api/podcasts/sessions/:sessionId', authMiddleware, async (req, res) => {
    try {
      const { lastSegmentIndex } = req.body ?? {};
      if (typeof lastSegmentIndex !== 'number' || lastSegmentIndex < 0) {
        res.status(400).json({ error: 'lastSegmentIndex must be a non-negative number' });
        return;
      }

      const updated = updateSessionProgress(
        paramStr(req.params.sessionId),
        req.user!.sub,
        lastSegmentIndex,
      );

      if (!updated) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      logger.error({ err: error, userId: req.user?.sub }, 'Failed to update session progress');
      res.status(500).json({ error: 'Unable to update progress' });
    }
  });

  // Toggle session favorite
  app.post('/api/podcasts/sessions/:sessionId/favorite', authMiddleware, async (req, res) => {
    try {
      const result = toggleSessionFavorite(paramStr(req.params.sessionId), req.user!.sub);
      if (result === undefined) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json({ favorite: result });
    } catch (error) {
      logger.error({ err: error, userId: req.user?.sub }, 'Failed to toggle favorite');
      res.status(500).json({ error: 'Unable to toggle favorite' });
    }
  });

  // Get segment audio (progressive — synthesizes on demand for pending segments)
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
        if (error instanceof ProviderUnavailableError) {
          res.status(503).json({ error: error.message, code: 'PROVIDER_UNAVAILABLE' });
          return;
        }
        logger.error({ err: error, userId: req.user?.sub }, 'Failed to get segment audio');
        res.status(500).json({ error: 'Unable to generate audio right now' });
      }
    },
  );

  // Text-only intervention (replaces old interrupt behavior for the new API)
  app.post(
    '/api/podcasts/sessions/:sessionId/interventions',
    authMiddleware,
    async (req, res) => {
      const { questionText, afterSegmentId, clientRequestId, playbackPositionSeconds, inputMethod } = req.body ?? {};

      // Reject voice input
      if (inputMethod === 'voice') {
        res.status(400).json({ error: 'Voice input is not supported for interventions. Use text-only.' });
        return;
      }

      if (typeof questionText !== 'string' || questionText.trim().length === 0) {
        res.status(400).json({ error: 'questionText is required' });
        return;
      }

      const trimmedQ = questionText.trim();
      if (trimmedQ.length < SESSION_LIMITS.questionMinLength) {
        res.status(400).json({ error: `Question must be at least ${SESSION_LIMITS.questionMinLength} characters` });
        return;
      }
      if (trimmedQ.length > SESSION_LIMITS.questionMaxLength) {
        res.status(400).json({ error: `Question must be ${SESSION_LIMITS.questionMaxLength} characters or fewer` });
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

      const positionRaw = playbackPositionSeconds;
      const position = typeof positionRaw === 'number'
        ? positionRaw
        : typeof positionRaw === 'string'
          ? Number.parseFloat(positionRaw)
          : 0;
      if (!Number.isFinite(position) || position < 0) {
        res.status(400).json({ error: 'playbackPositionSeconds must be >= 0' });
        return;
      }

      try {
        const result = await sessionService.processIntervention({
          sessionId: paramStr(req.params.sessionId),
          userId: req.user!.sub,
          questionText: trimmedQ,
          afterSegmentId,
          clientRequestId,
          playbackPositionSeconds: position,
        });

        const iv = result.intervention;
        const response: InterventionResponse = {
          id: iv.id,
          state: iv.state,
          capturedPositionSeconds: iv.capturedPositionSeconds,
          answerText: iv.answerText,
          answerAudioUrl: iv.state === 'ready'
            ? `/api/podcasts/sessions/${paramStr(req.params.sessionId)}/interventions/${iv.id}/audio`
            : undefined,
          errorCode: iv.state === 'failed' ? 'INTERVENTION_FAILED' : undefined,
        };

        res.status(200).json({ intervention: response });
      } catch (error) {
        if (error instanceof SessionNotFoundError) {
          res.status(404).json({ error: error.message });
          return;
        }
        if (error instanceof ProviderUnavailableError) {
          res.status(503).json({ error: error.message, code: 'PROVIDER_UNAVAILABLE' });
          return;
        }
        logger.error({ err: error, sessionId: paramStr(req.params.sessionId), userId: req.user?.sub }, 'Intervention failed');
        res.status(500).json({ error: 'Unable to process intervention right now', code: 'INTERVENTION_FAILED' });
      }
    },
  );

  // Get intervention answer audio
  app.get(
    '/api/podcasts/sessions/:sessionId/interventions/:interventionId/audio',
    authMiddleware,
    async (req, res) => {
      try {
        const audio = await sessionService.getInterventionAudio({
          sessionId: paramStr(req.params.sessionId),
          interventionId: paramStr(req.params.interventionId),
          userId: req.user!.sub,
        });

        if (!audio) {
          res.status(404).json({ error: 'Intervention audio not found or not yet ready' });
          return;
        }

        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', audio.length.toString());
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.send(audio);
      } catch (error) {
        logger.error({ err: error, userId: req.user?.sub }, 'Failed to get intervention audio');
        res.status(500).json({ error: 'Unable to retrieve intervention audio' });
      }
    },
  );

  // Cancel intervention
  app.delete(
    '/api/podcasts/sessions/:sessionId/interventions/:interventionId',
    authMiddleware,
    async (req, res) => {
      try {
        const cancelled = await sessionService.cancelIntervention({
          sessionId: paramStr(req.params.sessionId),
          interventionId: paramStr(req.params.interventionId),
          userId: req.user!.sub,
        });
        if (!cancelled) {
          res.status(404).json({ error: 'Intervention not found or already completed' });
          return;
        }
        res.json({ ok: true, message: 'Intervention cancelled' });
      } catch (error) {
        logger.error({ err: error, userId: req.user?.sub }, 'Failed to cancel intervention');
        res.status(500).json({ error: 'Unable to cancel intervention' });
      }
    },
  );

  // Episode resumption telemetry (authenticated, from web)
  app.post('/api/podcasts/sessions/:sessionId/resume', authMiddleware, async (req, res) => {
    const session = sessionService.getSession({
      sessionId: paramStr(req.params.sessionId),
      userId: req.user!.sub,
    });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    emitTelemetry({
      stage: 'episode_resumption',
      durationMs: 0,
      provider: process.env.PODCAST_PROVIDER?.trim().toLowerCase() === 'azure' ? 'azure' : 'mock',
      success: true,
      correlationId: session.id,
    });
    res.json({ ok: true });
  });

  // Legacy interrupt endpoint — kept for backward compatibility with old clients
  app.post(
    '/api/podcasts/sessions/:sessionId/interrupt',
    authMiddleware,
    async (req, res) => {
      const { questionText, inputMethod, afterSegmentId, clientRequestId } = req.body ?? {};

      if (typeof questionText !== 'string' || questionText.trim().length === 0) {
        res.status(400).json({ error: 'questionText is required' });
        return;
      }

      const trimmedQuestion = questionText.trim();
      if (trimmedQuestion.length < SESSION_LIMITS.questionMinLength) {
        res.status(400).json({ error: `Question must be at least ${SESSION_LIMITS.questionMinLength} characters` });
        return;
      }
      if (trimmedQuestion.length > SESSION_LIMITS.questionMaxLength) {
        res.status(400).json({ error: `Question must be ${SESSION_LIMITS.questionMaxLength} characters or fewer` });
        return;
      }

      // Reject voice inputMethod
      if (inputMethod === 'voice') {
        res.status(400).json({ error: 'Voice input is not supported. Use text inputMethod.' });
        return;
      }
      if (!['text', undefined, null].includes(inputMethod) && typeof inputMethod === 'string') {
        res.status(400).json({ error: 'inputMethod must be "text"' });
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
          inputMethod: 'text',
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
        if (error instanceof ProviderUnavailableError) {
          res.status(503).json({ error: error.message, code: 'PROVIDER_UNAVAILABLE' });
          return;
        }
        logger.error({ err: error, sessionId: paramStr(req.params.sessionId), userId: req.user?.sub }, 'Interrupt processing failed');
        res.status(500).json({ error: 'Unable to process interrupt right now' });
      }
    },
  );

  // Get chat messages for a session
  app.get('/api/podcasts/sessions/:sessionId/chat', authMiddleware, async (req, res) => {
    try {
      const session = sessionService.getSession({
        sessionId: paramStr(req.params.sessionId),
        userId: req.user!.sub,
      });
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const messages = getChatMessages(session.id);
      res.json({ messages });
    } catch (error) {
      logger.error({ err: error, userId: req.user?.sub }, 'Failed to get chat messages');
      res.status(500).json({ error: 'Unable to load chat messages' });
    }
  });

  // Send a chat message (triggers interrupt)
  app.post('/api/podcasts/sessions/:sessionId/chat', authMiddleware, async (req, res) => {
    const { message, inputMethod, afterSegmentId, clientRequestId } = req.body ?? {};

    if (typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    const trimmedMessage = message.trim();
    if (trimmedMessage.length < SESSION_LIMITS.questionMinLength) {
      res.status(400).json({ error: `Message must be at least ${SESSION_LIMITS.questionMinLength} characters` });
      return;
    }
    if (trimmedMessage.length > SESSION_LIMITS.questionMaxLength) {
      res.status(400).json({ error: `Message must be ${SESSION_LIMITS.questionMaxLength} characters or fewer` });
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
    const resolvedInputMethod = inputMethod === 'voice' ? 'voice' : 'text';

    try {
      const userMsg = addChatMessage({
        sessionId: paramStr(req.params.sessionId),
        role: 'user',
        content: trimmedMessage,
      });

      const result = await sessionService.processInterrupt({
        sessionId: paramStr(req.params.sessionId),
        userId: req.user!.sub,
        questionText: trimmedMessage,
        inputMethod: resolvedInputMethod,
        afterSegmentId,
        clientRequestId,
      });

      const newSegCount = result.newSegments.length;
      const assistantContent = newSegCount > 0
        ? `Got it! I've updated the episode based on your feedback. ${newSegCount} new segment${newSegCount !== 1 ? 's' : ''} generated after your edit point.`
        : 'Your edit has been noted. The episode continues from the current point.';

      const assistantMsg = addChatMessage({
        sessionId: paramStr(req.params.sessionId),
        role: 'assistant',
        content: assistantContent,
        interruptId: result.session.interrupts[result.session.interrupts.length - 1]?.id,
      });

      res.json({ session: toSessionResponse(result.session), chatMessages: [userMsg, assistantMsg] });
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
      logger.error({ err: error, sessionId: paramStr(req.params.sessionId) }, 'Chat interrupt failed');
      res.status(500).json({ error: 'Unable to process your edit right now' });
    }
  });

  // Export full episode audio
  app.get(
    '/api/podcasts/sessions/:sessionId/export-audio',
    authMiddleware,
    async (req, res) => {
      try {
        const session = sessionService.getSession({
          sessionId: paramStr(req.params.sessionId),
          userId: req.user!.sub,
        });

        if (!session) {
          res.status(404).json({ error: 'Session not found' });
          return;
        }

        const activeSegs = getActiveSegments(session);
        const buffers: Buffer[] = [];
        for (const seg of activeSegs) {
          const audio = await sessionService.getSegmentAudio({
            sessionId: session.id,
            segmentId: seg.id,
            userId: req.user!.sub,
          });
          if (audio) buffers.push(audio);
        }

        if (buffers.length === 0) {
          res.status(400).json({ error: 'No audio available for this session' });
          return;
        }

        const combined = Buffer.concat(buffers);
        const safeTopic = session.topic.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', combined.length.toString());
        res.setHeader('Content-Disposition', `attachment; filename="${safeTopic}.wav"`);
        res.send(combined);
      } catch (error) {
        logger.error({ err: error, userId: req.user?.sub }, 'Failed to export session audio');
        res.status(500).json({ error: 'Unable to export audio right now' });
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

// ─── Control Parsing ─────────────────────────────────────────────────

interface ControlParseOk {
  ok: true;
  controls: PodcastGenerationControls;
}

interface ControlParseError {
  ok: false;
  error: string;
  field: 'audienceLevel' | 'durationMinutes' | 'conversationStyle';
}

function parseControls(body: Record<string, unknown>): ControlParseOk | ControlParseError {
  const { audienceLevel, durationMinutes, conversationStyle } = body;

  const resolvedLevel: PodcastAudienceLevel =
    audienceLevel === undefined || audienceLevel === null
      ? DEFAULT_CONTROLS.audienceLevel
      : audienceLevel as PodcastAudienceLevel;

  if (!VALID_AUDIENCE_LEVELS.includes(resolvedLevel)) {
    return {
      ok: false,
      error: `audienceLevel must be one of: ${VALID_AUDIENCE_LEVELS.join(', ')}`,
      field: 'audienceLevel',
    };
  }

  const rawDuration = durationMinutes === undefined || durationMinutes === null
    ? DEFAULT_CONTROLS.durationMinutes
    : typeof durationMinutes === 'string'
      ? Number.parseInt(durationMinutes, 10)
      : durationMinutes;

  const resolvedDuration = rawDuration as PodcastDurationMinutes;
  if (!VALID_DURATION_MINUTES.includes(resolvedDuration as PodcastDurationMinutes)) {
    return {
      ok: false,
      error: `durationMinutes must be one of: ${VALID_DURATION_MINUTES.join(', ')}`,
      field: 'durationMinutes',
    };
  }

  const resolvedStyle: PodcastConversationStyle =
    conversationStyle === undefined || conversationStyle === null
      ? DEFAULT_CONTROLS.conversationStyle
      : conversationStyle as PodcastConversationStyle;

  if (!VALID_CONVERSATION_STYLES.includes(resolvedStyle)) {
    return {
      ok: false,
      error: `conversationStyle must be one of: ${VALID_CONVERSATION_STYLES.join(', ')}`,
      field: 'conversationStyle',
    };
  }

  return {
    ok: true,
    controls: {
      audienceLevel: resolvedLevel,
      durationMinutes: resolvedDuration,
      conversationStyle: resolvedStyle,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parseTopic(body: Record<string, unknown>): string | null {
  if (typeof body?.topic !== 'string') return null;
  const topic = body.topic.trim();
  return topic.length > 0 ? topic : null;
}

function segmentToTurns(seg: PodcastSegment): TranscriptTurnResponse[] {
  return [
    { speaker: 'host', text: seg.hostLine },
    { speaker: 'guest', text: seg.guestLine },
  ];
}

function mapSegmentStatus(status: string): string {
  // Map internal segment status to PodcastAudioSegmentState
  switch (status) {
    case 'ready': return 'ready';
    case 'generating': return 'preparing';
    case 'pending': return 'pending';
    case 'failed': return 'failed';
    default: return status;
  }
}

function toSessionResponse(session: PodcastSession): SessionResponse {
  const activeSegments = getActiveSegments(session);
  const transcript: TranscriptTurnResponse[] = activeSegments.flatMap(segmentToTurns);

  return {
    id: session.id,
    topic: session.topic,
    title: session.title,
    summary: session.summary,
    revision: session.revision,
    status: session.status,
    controls: session.controls,
    generationState: session.generationState,
    estimatedDurationMinutes: session.estimatedDurationMinutes,
    transcript,
    lastSegmentIndex: session.lastSegmentIndex,
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
    turns: segmentToTurns(segment),
    status: segment.status,
    audioStatus: mapSegmentStatus(segment.status),
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
