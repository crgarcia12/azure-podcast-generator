export interface PodcastTranscriptTurn {
  id: string;
  speaker: 'host' | 'guest';
  speakerLabel: 'Host' | 'Guest';
  voice: string;
  text: string;
}

export interface PodcastEpisodeDraft {
  id: string;
  ownerId: string;
  topic: string;
  title: string;
  summary: string;
  transcript: PodcastTranscriptTurn[];
  createdAt: string;
}

export interface StoredPodcastEpisode extends PodcastEpisodeDraft {
  audioBuffer: Buffer;
  audioContentType: string;
  segments?: StoredSteeredSegment[];
}

export interface SteeredSegmentTurn {
  id: string;
  speaker: 'host' | 'guest';
  speakerLabel: 'Host' | 'Guest';
  voice: string;
  text: string;
}

export interface StoredSteeredSegment {
  id: string;
  episodeId: string;
  question: string;
  playbackPositionSeconds: number;
  createdAt: string;
  durationSeconds: number;
  transcript: SteeredSegmentTurn[];
  audioBuffer: Buffer;
  audioContentType: string;
}

const episodes = new Map<string, StoredPodcastEpisode>();

export function savePodcastEpisode(episode: StoredPodcastEpisode): void {
  episodes.set(episode.id, episode);
}

export function getPodcastEpisodeById(episodeId: string): StoredPodcastEpisode | undefined {
  return episodes.get(episodeId);
}

export function getEpisodesByOwner(ownerId: string): StoredPodcastEpisode[] {
  return Array.from(episodes.values())
    .filter((ep) => ep.ownerId === ownerId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function appendSteeredSegment(
  episodeId: string,
  segment: StoredSteeredSegment,
): StoredSteeredSegment | undefined {
  const episode = episodes.get(episodeId);
  if (!episode) {
    return undefined;
  }

  const segments = episode.segments ?? [];
  segments.push(segment);
  episode.segments = segments;
  return segment;
}

export function getSteeredSegment(
  episodeId: string,
  segmentId: string,
): StoredSteeredSegment | undefined {
  const episode = episodes.get(episodeId);
  return episode?.segments?.find((seg) => seg.id === segmentId);
}

export function clearPodcastEpisodes(): void {
  episodes.clear();
}
