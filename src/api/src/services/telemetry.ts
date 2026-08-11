// Allow-listed telemetry helper — never emits topics, transcripts, audio, credentials, or raw errors.
import { logger } from '../logger.js';

export type TelemetryStage =
  | 'script_generation'
  | 'initial_audio_readiness'
  | 'question_acknowledgement'
  | 'answer_readiness'
  | 'episode_resumption';

export interface TelemetryEvent {
  stage: TelemetryStage;
  durationMs: number;
  provider: 'mock' | 'azure';
  success: boolean;
  correlationId: string;
  errorCode?: string;
}

// Strictly allow-listed field names — must never include topics, transcripts, audio, credentials, or exceptions.
export const TELEMETRY_ALLOWED_FIELDS: ReadonlySet<string> = new Set<string>([
  'stage',
  'durationMs',
  'provider',
  'success',
  'correlationId',
  'errorCode',
]);

export function emitTelemetry(event: TelemetryEvent): void {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (TELEMETRY_ALLOWED_FIELDS.has(key) && value !== undefined) {
      safe[key] = value;
    }
  }
  logger.info({ telemetry: safe }, 'telemetry_event');
}

export function startTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}
