// Reusable transcript validator — exported so tests can verify allow-listing and logic.

export const CANONICAL_WPM = 145;
export const MAX_WORDS_PER_TURN = 80;
export const WORD_COUNT_TOLERANCE = 0.2; // ±20%

export type TranscriptSpeaker = 'host' | 'guest';

export interface TranscriptTurn {
  speaker: TranscriptSpeaker;
  text: string;
}

export interface TranscriptValidationResult {
  valid: boolean;
  errors: string[];
  totalWords: number;
  targetWords: number;
  minWords: number;
  maxWords: number;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function validateTranscript(
  turns: TranscriptTurn[],
  durationMinutes: number,
): TranscriptValidationResult {
  const targetWords = Math.round(durationMinutes * CANONICAL_WPM);
  const minWords = Math.floor(targetWords * (1 - WORD_COUNT_TOLERANCE));
  const maxWords = Math.ceil(targetWords * (1 + WORD_COUNT_TOLERANCE));
  const errors: string[] = [];

  if (turns.length < 2) {
    errors.push(`Transcript must have at least 2 turns (got ${turns.length})`);
    return { valid: false, errors, totalWords: 0, targetWords, minWords, maxWords };
  }

  if (turns.length % 2 !== 0) {
    errors.push(`Transcript must contain complete host/guest pairs (got ${turns.length} turns)`);
  }

  if (turns[0].speaker !== 'host') {
    errors.push(`First turn must be from host (got ${turns[0].speaker})`);
  }

  let totalWords = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const expectedSpeaker: TranscriptSpeaker = i % 2 === 0 ? 'host' : 'guest';

    if (turn.speaker !== expectedSpeaker) {
      errors.push(`Turn ${i + 1} should be ${expectedSpeaker} but got ${turn.speaker}`);
    }

    if (!turn.text.trim()) {
      errors.push(`Turn ${i + 1} text is blank`);
    }

    const wc = countWords(turn.text);
    if (wc > MAX_WORDS_PER_TURN) {
      errors.push(`Turn ${i + 1} has ${wc} words (max ${MAX_WORDS_PER_TURN})`);
    }

    totalWords += wc;
  }

  if (totalWords < minWords || totalWords > maxWords) {
    errors.push(
      `Total word count ${totalWords} is outside ±20% of target ${targetWords} for ${durationMinutes} min (range ${minWords}–${maxWords})`,
    );
  }

  return { valid: errors.length === 0, errors, totalWords, targetWords, minWords, maxWords };
}
