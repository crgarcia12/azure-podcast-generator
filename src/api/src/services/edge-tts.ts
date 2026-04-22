import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { logger } from '../logger.js';

const DEFAULT_HOST_VOICE = 'en-US-JennyNeural';
const DEFAULT_GUEST_VOICE = 'en-US-GuyNeural';

/**
 * Synthesize a single text segment into an MP3 buffer using Edge TTS.
 */
async function synthesizeSegment(voice: string, text: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
}

/**
 * Synthesize a full podcast transcript (alternating host/guest turns) into
 * a single concatenated MP3 buffer.
 */
export async function synthesizeTranscript(
  turns: Array<{ speaker: 'host' | 'guest'; text: string; voice?: string }>,
): Promise<Buffer> {
  const buffers: Buffer[] = [];

  for (const turn of turns) {
    const voice =
      turn.voice ??
      (turn.speaker === 'host' ? DEFAULT_HOST_VOICE : DEFAULT_GUEST_VOICE);
    try {
      const audio = await synthesizeSegment(voice, turn.text);
      buffers.push(audio);
    } catch (err) {
      logger.warn({ err, voice, textLength: turn.text.length }, 'Edge TTS failed for turn — skipping');
    }
  }

  if (buffers.length === 0) {
    throw new Error('Edge TTS failed to synthesize any audio');
  }

  return Buffer.concat(buffers);
}

/**
 * Synthesize a single line of text for a given speaker.
 */
export async function synthesizeLine(
  speaker: 'host' | 'guest',
  text: string,
): Promise<Buffer> {
  const voice = speaker === 'host' ? DEFAULT_HOST_VOICE : DEFAULT_GUEST_VOICE;
  return synthesizeSegment(voice, text);
}
