export type PodcastGenerationState =
  | 'generating'
  | 'complete'
  | 'stopped'
  | 'failed'
  | 'limit-reached';

export type PodcastCompletionReason =
  | 'target-reached'
  | 'stopped'
  | 'provider-limit'
  | 'provider-failed'
  | null;

export interface PodcastExchange {
  id: string;
  order: number;
  question: string;
  answer: string;
}

export interface PodcastBatch {
  id: string;
  sequence: number;
  exchanges: PodcastExchange[];
  wordCount: number;
  estimatedDurationMinutes: number;
}

export interface PodcastGenerationProgress {
  generatedDurationMinutes: number;
  targetDurationMinutes: number;
  state: PodcastGenerationState;
  completionReason: PodcastCompletionReason;
  nextBatchSequence: number;
  providerCallCount: number;
  failedSequence: number | null;
}

export interface PodcastBatchRequest {
  topic: string;
  style: string;
  sequence: number;
  targetDurationMinutes: number;
  generatedDurationMinutes: number;
  coveredQuestions: string[];
}
