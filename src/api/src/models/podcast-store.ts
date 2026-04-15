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
}

const episodes = new Map<string, StoredPodcastEpisode>();

export function savePodcastEpisode(episode: StoredPodcastEpisode): void {
  episodes.set(episode.id, episode);
}

export function getPodcastEpisodeById(episodeId: string): StoredPodcastEpisode | undefined {
  return episodes.get(episodeId);
}

export function clearPodcastEpisodes(): void {
  episodes.clear();
}
