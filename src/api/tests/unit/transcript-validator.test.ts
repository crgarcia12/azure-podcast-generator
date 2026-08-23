import { describe, it, expect } from 'vitest';
import {
  validateTranscript,
  countWords,
  CANONICAL_WPM,
  MAX_WORDS_PER_TURN,
  WORD_COUNT_TOLERANCE,
  type TranscriptTurn,
} from '../../src/services/transcript-validator.js';

describe('countWords', () => {
  it('counts words in a simple string', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('one two three four')).toBe(4);
  });

  it('handles extra whitespace', () => {
    expect(countWords('  hello   world  ')).toBe(2);
    expect(countWords('a  b  c')).toBe(3);
  });

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});

describe('validateTranscript', () => {
  const durationMinutes = 5;
  const targetWords = durationMinutes * CANONICAL_WPM;
  const minWords = Math.floor(targetWords * (1 - WORD_COUNT_TOLERANCE));
  const maxWords = Math.ceil(targetWords * (1 + WORD_COUNT_TOLERANCE));

  function makeTurns(n: number, wordsPerTurn: number): TranscriptTurn[] {
    const word = 'word';
    const text = Array(wordsPerTurn).fill(word).join(' ');
    return Array.from({ length: n }, (_, i) => ({
      speaker: i % 2 === 0 ? 'host' : 'guest',
      text,
    })) as TranscriptTurn[];
  }

  it('returns valid for a well-formed transcript', () => {
    // Target 725 words for 5 min — aim for 14 turns at 52 words each = 728 words (within ±20%)
    const turns = makeTurns(14, 52);
    const result = validateTranscript(turns, durationMinutes);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.totalWords).toBe(14 * 52);
  });

  it('fails when fewer than 2 turns', () => {
    const result = validateTranscript([{ speaker: 'host', text: 'hello world' }], durationMinutes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('2 turns'))).toBe(true);
  });

  it('fails when first turn is not host', () => {
    const turns: TranscriptTurn[] = [
      { speaker: 'guest', text: Array(60).fill('word').join(' ') },
      { speaker: 'host', text: Array(60).fill('word').join(' ') },
    ];
    const result = validateTranscript(turns, durationMinutes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('host'))).toBe(true);
  });

  it('fails when turns do not alternate', () => {
    const text = Array(50).fill('word').join(' ');
    const turns: TranscriptTurn[] = [
      { speaker: 'host', text },
      { speaker: 'host', text }, // should be guest
      { speaker: 'guest', text },
    ];
    const result = validateTranscript(turns, durationMinutes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Turn 2'))).toBe(true);
  });

  it('fails when a turn has blank text', () => {
    const turns: TranscriptTurn[] = [
      { speaker: 'host', text: '   ' },
      { speaker: 'guest', text: Array(60).fill('word').join(' ') },
    ];
    const result = validateTranscript(turns, durationMinutes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('blank'))).toBe(true);
  });

  it('fails when a turn exceeds MAX_WORDS_PER_TURN', () => {
    const text = Array(MAX_WORDS_PER_TURN + 5).fill('word').join(' ');
    const turns: TranscriptTurn[] = [
      { speaker: 'host', text },
      { speaker: 'guest', text: Array(50).fill('word').join(' ') },
    ];
    const result = validateTranscript(turns, durationMinutes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('max 80'))).toBe(true);
  });

  it('fails when total word count is below minimum', () => {
    // 2 turns × 10 words = 20 words — well below minWords for 5 min (580)
    const turns = makeTurns(2, 10);
    const result = validateTranscript(turns, durationMinutes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('outside'))).toBe(true);
  });

  it('fails when total word count exceeds maximum', () => {
    // Lots of turns × 80 words = way over 870 words
    const turns = makeTurns(20, 80);
    const result = validateTranscript(turns, durationMinutes);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('outside'))).toBe(true);
  });

  it('returns correct metadata', () => {
    const turns = makeTurns(10, 60);
    const result = validateTranscript(turns, durationMinutes);
    expect(result.totalWords).toBe(600);
    expect(result.targetWords).toBe(targetWords);
    expect(result.minWords).toBe(minWords);
    expect(result.maxWords).toBe(maxWords);
  });

  it('validates 10-minute transcript correctly', () => {
    // 1450 words target, ±20% = 1160-1740
    const turns = makeTurns(20, 72); // 20 × 72 = 1440 words
    const result = validateTranscript(turns, 10);
    expect(result.valid).toBe(true);
  });

  it('validates 15-minute transcript correctly', () => {
    // 2175 words target, ±20% = 1740-2610
    const turns = makeTurns(30, 72); // 30 × 72 = 2160 words
    const result = validateTranscript(turns, 15);
    expect(result.valid).toBe(true);
  });
});

describe('exported constants', () => {
  it('CANONICAL_WPM is 145', () => {
    expect(CANONICAL_WPM).toBe(145);
  });

  it('MAX_WORDS_PER_TURN is 80', () => {
    expect(MAX_WORDS_PER_TURN).toBe(80);
  });

  it('WORD_COUNT_TOLERANCE is 0.2', () => {
    expect(WORD_COUNT_TOLERANCE).toBe(0.2);
  });
});
