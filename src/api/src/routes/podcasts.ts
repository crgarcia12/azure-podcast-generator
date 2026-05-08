import { type Express } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  PODCAST_TOPIC_MAX_LENGTH,
  PodcastConfigurationError,
  PodcastDependencyError,
  PodcastEpisodeNotFoundError,
  QUESTION_MAX_LENGTH,
  QUESTION_MIN_LENGTH,
  type PodcastEpisodeDraft,
  type PodcastService,
  type StoredPodcastEpisode,
  type StoredSteeredSegment,
} from '../services/podcast-service.js';
import { logger } from '../logger.js';

interface CreatePodcastBody {
  topic?: unknown;
}

interface AskQuestionBody {
  question?: unknown;
  playbackPositionSeconds?: unknown;
}

interface PodcastEpisodeResponse {
  id: string;
  topic: string;
  title: string;
  summary: string;
  createdAt: string;
  transcript: Array<{
    id: string;
    speaker: 'host' | 'guest';
    speakerLabel: 'Host' | 'Guest';
    text: string;
  }>;
  audioAvailable: boolean;
  audioUrl: string | null;
  audioContentType: string | null;
}

interface SteeredSegmentResponse {
  segmentId: string;
  episodeId: string;
  question: string;
  playbackPositionSeconds: number;
  durationSeconds: number;
  transcript: Array<{
    id: string;
    speaker: 'host' | 'guest';
    speakerLabel: 'Host' | 'Guest';
    text: string;
  }>;
  audioUrl: string;
  audioContentType: string;
  createdAt: string;
}

export function mapPodcastEndpoints(app: Express, podcastService: PodcastService): void {
  app.get('/api/podcasts', authMiddleware, async (req, res) => {
    try {
      const episodes = await podcastService.listEpisodes({ ownerId: req.user!.sub });
      res.json({
        episodes: episodes.map((ep) => toEpisodeResponse(ep)),
      });
    } catch (error) {
      logger.error({ err: error, userId: req.user?.sub }, 'Failed to list episodes');
      res.status(500).json({ error: 'Unable to load episodes right now' });
    }
  });

  app.post('/api/podcasts', authMiddleware, async (req, res) => {
    const topic = parseTopic(req.body as CreatePodcastBody);
    if (!topic) {
      res.status(400).json({ error: 'Topic is required' });
      return;
    }

    if (topic.length > PODCAST_TOPIC_MAX_LENGTH) {
      res
        .status(400)
        .json({ error: `Topic must be ${PODCAST_TOPIC_MAX_LENGTH} characters or fewer` });
      return;
    }

    try {
      const episode = await podcastService.createEpisode({
        ownerId: req.user!.sub,
        topic,
      });

      res.status(201).json({
        episode: toEpisodeResponse(episode),
      });
    } catch (error) {
      if (error instanceof PodcastConfigurationError) {
        logger.warn({ userId: req.user?.sub }, error.message);
        res.status(503).json({ error: error.message });
        return;
      }

      if (error instanceof PodcastDependencyError) {
        logger.error(
          { err: error, topic, userId: req.user?.sub },
          'Podcast generation dependency failed',
        );

        res.status(502).json({
          error: error.message,
          draftEpisode: error.draftEpisode ? toEpisodeResponse(error.draftEpisode) : undefined,
        });
        return;
      }

      logger.error({ err: error, topic, userId: req.user?.sub }, 'Podcast generation failed');
      res.status(500).json({ error: 'Unable to create a podcast right now' });
    }
  });

  app.get('/api/podcasts/:episodeId/audio', authMiddleware, async (req, res) => {
    const episodeId = Array.isArray(req.params.episodeId)
      ? req.params.episodeId[0]
      : req.params.episodeId;

    if (!episodeId) {
      res.status(404).json({ error: 'Podcast not found' });
      return;
    }

    const episode = await podcastService.getEpisodeById({
      episodeId,
      ownerId: req.user!.sub,
    });

    if (!episode) {
      res.status(404).json({ error: 'Podcast not found' });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', episode.audioContentType);
    res.setHeader('Content-Length', episode.audioBuffer.length.toString());
    res.send(episode.audioBuffer);
  });

  app.post('/api/podcasts/:episodeId/questions', authMiddleware, async (req, res) => {
    const episodeId = Array.isArray(req.params.episodeId)
      ? req.params.episodeId[0]
      : req.params.episodeId;

    if (!episodeId) {
      res.status(404).json({ error: 'Podcast not found' });
      return;
    }

    const parsed = parseAskQuestion(req.body as AskQuestionBody);
    if (!parsed) {
      res.status(400).json({
        error: `Question must be between ${QUESTION_MIN_LENGTH} and ${QUESTION_MAX_LENGTH} characters`,
      });
      return;
    }

    try {
      const segment = await podcastService.generateSteeredSegment({
        ownerId: req.user!.sub,
        episodeId,
        question: parsed.question,
        playbackPositionSeconds: parsed.playbackPositionSeconds,
      });

      res.status(200).json({
        segment: toSegmentResponse(segment),
      });
    } catch (error) {
      if (error instanceof PodcastEpisodeNotFoundError) {
        res.status(404).json({ error: 'Podcast not found' });
        return;
      }

      if (error instanceof PodcastConfigurationError) {
        logger.warn({ userId: req.user?.sub }, error.message);
        res.status(503).json({ error: error.message });
        return;
      }

      if (error instanceof PodcastDependencyError) {
        logger.error(
          { err: error, episodeId, userId: req.user?.sub },
          'Steered segment generation failed',
        );
        res.status(502).json({ error: error.message });
        return;
      }

      logger.error({ err: error, episodeId, userId: req.user?.sub }, 'Steered segment failed');
      res.status(500).json({ error: 'Unable to answer the listener question right now' });
    }
  });

  app.get(
    '/api/podcasts/:episodeId/segments/:segmentId/audio',
    authMiddleware,
    async (req, res) => {
      const episodeId = Array.isArray(req.params.episodeId)
        ? req.params.episodeId[0]
        : req.params.episodeId;
      const segmentId = Array.isArray(req.params.segmentId)
        ? req.params.segmentId[0]
        : req.params.segmentId;

      if (!episodeId || !segmentId) {
        res.status(404).json({ error: 'Segment not found' });
        return;
      }

      const segment = await podcastService.getSteeredSegment({
        ownerId: req.user!.sub,
        episodeId,
        segmentId,
      });

      if (!segment) {
        res.status(404).json({ error: 'Segment not found' });
        return;
      }

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', segment.audioContentType);
      res.setHeader('Content-Length', segment.audioBuffer.length.toString());
      res.send(segment.audioBuffer);
    },
  );
}

function parseTopic(body: CreatePodcastBody): string | null {
  if (typeof body.topic !== 'string') {
    return null;
  }

  const topic = body.topic.trim();
  return topic.length > 0 ? topic : null;
}

function parseAskQuestion(
  body: AskQuestionBody,
): { question: string; playbackPositionSeconds: number } | null {
  if (typeof body.question !== 'string') {
    return null;
  }

  const question = body.question.trim();
  if (question.length < QUESTION_MIN_LENGTH || question.length > QUESTION_MAX_LENGTH) {
    return null;
  }

  const positionRaw = body.playbackPositionSeconds;
  const playbackPositionSeconds = typeof positionRaw === 'number'
    ? positionRaw
    : typeof positionRaw === 'string'
      ? Number.parseFloat(positionRaw)
      : 0;

  if (!Number.isFinite(playbackPositionSeconds) || playbackPositionSeconds < 0) {
    return null;
  }

  return { question, playbackPositionSeconds };
}

function toSegmentResponse(segment: StoredSteeredSegment): SteeredSegmentResponse {
  return {
    segmentId: segment.id,
    episodeId: segment.episodeId,
    question: segment.question,
    playbackPositionSeconds: segment.playbackPositionSeconds,
    durationSeconds: segment.durationSeconds,
    transcript: segment.transcript.map((turn) => ({
      id: turn.id,
      speaker: turn.speaker,
      speakerLabel: turn.speakerLabel,
      text: turn.text,
    })),
    audioUrl: `/api/podcasts/${segment.episodeId}/segments/${segment.id}/audio`,
    audioContentType: segment.audioContentType,
    createdAt: segment.createdAt,
  };
}

function toEpisodeResponse(
  episode: PodcastEpisodeDraft | StoredPodcastEpisode,
): PodcastEpisodeResponse {
  const hasAudio = 'audioBuffer' in episode;

  return {
    id: episode.id,
    topic: episode.topic,
    title: episode.title,
    summary: episode.summary,
    createdAt: episode.createdAt,
    transcript: episode.transcript.map((turn) => ({
      id: turn.id,
      speaker: turn.speaker,
      speakerLabel: turn.speakerLabel,
      text: turn.text,
    })),
    audioAvailable: hasAudio,
    audioUrl: hasAudio ? `/api/podcasts/${episode.id}/audio` : null,
    audioContentType: hasAudio ? episode.audioContentType : null,
  };
}
