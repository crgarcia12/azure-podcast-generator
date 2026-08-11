export const AUDIENCE_LEVELS = ['Beginner', 'Intermediate', 'Expert'] as const;
export const EPISODE_DURATIONS = [5, 10, 15] as const;
export const CONVERSATION_STYLES = ['Conversational', 'Educational', 'Debate'] as const;

export type AudienceLevel = (typeof AUDIENCE_LEVELS)[number];
export type EpisodeDurationMinutes = (typeof EPISODE_DURATIONS)[number];
export type ConversationStyle = (typeof CONVERSATION_STYLES)[number];
export type PodcastGenerationStatus = 'generating_script' | 'preparing_audio' | 'ready' | 'failed';
export type InterventionStatus =
  | 'idle'
  | 'received'
  | 'answering'
  | 'ready'
  | 'playing'
  | 'failed'
  | 'resumed';

export interface PodcastGenerationControls {
  audience: AudienceLevel;
  durationMinutes: EpisodeDurationMinutes;
  style: ConversationStyle;
}

export interface PodcastTranscriptTurn {
  id: string;
  speaker: 'host' | 'guest';
  speakerLabel: 'Host' | 'Guest';
  text: string;
}

export interface PodcastAudioSegment {
  id: string;
  index: number;
  turnStart: number;
  turnEnd: number;
  status: 'ready' | 'pending' | 'failed';
  audioUrl: string | null;
  audioContentType: string | null;
}

export interface PodcastEpisodeContract {
  id: string;
  topic: string;
  title: string;
  summary: string;
  createdAt: string;
  controls: PodcastGenerationControls;
  provider: 'azure' | 'mock';
  generationStatus: PodcastGenerationStatus;
  transcript: PodcastTranscriptTurn[];
  audioSegments: PodcastAudioSegment[];
  audioAvailable: boolean;
}

export interface PodcastTimingEvent {
  stage:
    | 'script_generation'
    | 'initial_audio_ready'
    | 'question_acknowledged'
    | 'answer_ready'
    | 'episode_resumed';
  durationMs: number;
  provider: 'azure' | 'mock';
  success: boolean;
}
