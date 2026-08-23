export type PodcastAudienceLevel = 'beginner' | 'intermediate' | 'expert';
export type PodcastDurationMinutes = 5 | 10 | 15;
export type PodcastConversationStyle = 'conversational' | 'educational' | 'debate';
export type PodcastSpeaker = 'host' | 'guest';
export type PodcastGenerationState = 'generating-script' | 'preparing-audio' | 'ready' | 'failed';
export type PodcastAudioSegmentState = 'pending' | 'preparing' | 'ready' | 'failed';
export type PodcastInterventionState =
  | 'received'
  | 'answering'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'resumed';

export interface PodcastGenerationRequest {
  topic: string;
  audienceLevel?: PodcastAudienceLevel;
  durationMinutes?: PodcastDurationMinutes;
  conversationStyle?: PodcastConversationStyle;
}

export interface PodcastGenerationControls {
  audienceLevel: PodcastAudienceLevel;
  durationMinutes: PodcastDurationMinutes;
  conversationStyle: PodcastConversationStyle;
}

export interface PodcastTranscriptTurn {
  speaker: PodcastSpeaker;
  text: string;
}

export interface PodcastAudioSegment {
  id: string;
  index: number;
  turns: PodcastTranscriptTurn[];
  status: PodcastAudioSegmentState;
  audioUrl: string;
  errorCode?: string;
}

export interface PodcastSessionContract {
  id: string;
  topic: string;
  title: string;
  summary: string;
  controls: PodcastGenerationControls;
  generationState: PodcastGenerationState;
  estimatedDurationMinutes: number;
  transcript: PodcastTranscriptTurn[];
  segments: PodcastAudioSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface PodcastInterventionRequest {
  questionText: string;
  afterSegmentId: string;
  clientRequestId: string;
  playbackPositionSeconds: number;
}

export interface PodcastInterventionContract {
  id: string;
  state: PodcastInterventionState;
  capturedPositionSeconds: number;
  answerText?: string;
  answerAudioUrl?: string;
  errorCode?: string;
}

export interface PodcastValidationError {
  error: string;
  code: string;
  field?: keyof PodcastGenerationRequest;
}
