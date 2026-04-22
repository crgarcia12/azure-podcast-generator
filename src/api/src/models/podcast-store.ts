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
  audioBuffer?: Buffer;
  audioContentType?: string;
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

export function clearPodcastEpisodes(): void {
  episodes.clear();
}
