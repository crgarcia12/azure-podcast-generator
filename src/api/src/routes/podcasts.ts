import { type Express } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  PODCAST_TOPIC_MAX_LENGTH,
  PodcastConfigurationError,
  PodcastDependencyError,
  type PodcastEpisodeDraft,
  type PodcastService,
  type StoredPodcastEpisode,
} from '../services/podcast-service.js';
import { logger } from '../logger.js';

interface CreatePodcastBody {
  topic?: unknown;
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
}

function parseTopic(body: CreatePodcastBody): string | null {
  if (typeof body.topic !== 'string') {
    return null;
  }

  const topic = body.topic.trim();
  return topic.length > 0 ? topic : null;
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
