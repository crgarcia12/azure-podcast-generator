import {
  createSession,
  getOwnedSession,
  getSessionSummariesByUser,
  deleteSession,
  beginInterrupt,
  completeInterrupt,
  failInterrupt,
  type PodcastSession,
  type PodcastSegment,
  type PodcastSessionSummary,
  type InterruptResult,
} from '../models/session-store.js';
import {
  getSegmentAudio,
  setSegmentAudio,
} from '../models/audio-store.js';
import { synthesizeLine } from './edge-tts.js';
import { logger } from '../logger.js';

// ─── Types ───────────────────────────────────────────────────────────

interface SegmentScript {
  hostLine: string;
  guestLine: string;
}

export interface InteractiveSessionService {
  createSession(input: { userId: string; topic: string }): Promise<PodcastSession>;
  getSession(input: { sessionId: string; userId: string }): PodcastSession | undefined;
  listSessions(input: { userId: string }): PodcastSessionSummary[];
  deleteSession(input: { sessionId: string; userId: string }): boolean;
  getSegmentAudio(input: {
    sessionId: string;
    segmentId: string;
    userId: string;
  }): Promise<Buffer | null>;
  processInterrupt(input: {
    sessionId: string;
    userId: string;
    questionText: string;
    inputMethod: 'voice' | 'text';
    afterSegmentId: string;
    clientRequestId: string;
  }): Promise<InterruptResult>;
}

// ─── Mock Provider ───────────────────────────────────────────────────

// Voice names for future Azure Speech integration
// const DEFAULT_HOST_VOICE = 'en-US-JennyNeural';
// const DEFAULT_GUEST_VOICE = 'en-US-GuyNeural';

function buildMockSegments(topic: string): SegmentScript[] {
  return [
    {
      hostLine: `Welcome back. Today we are diving into ${topic}, and I want to unpack why this story still matters.`,
      guestLine: `${toTitleCase(topic)} is a strong topic because it mixes history, personalities, and the decisions that changed an industry.`,
    },
    {
      hostLine: `Set the scene for us. What is the first thing a listener should understand before the timeline gets complicated?`,
      guestLine: `Start with the early context, then connect the big milestones, and finally explain how those moments still shape the present-day conversation.`,
    },
    {
      hostLine: `That gives us the backbone. What is the biggest takeaway a listener should keep in mind at the end?`,
      guestLine: `The biggest takeaway is that ${topic} is not just a sequence of facts. It is a story about decisions, trade-offs, and long-term consequences.`,
    },
  ];
}

function buildMockInterruptSegments(questionText: string, topic: string): SegmentScript[] {
  return [
    {
      hostLine: `Great question from our listener: "${questionText}" — let me put that to our guest.`,
      guestLine: `That is a really interesting angle. When it comes to ${topic}, ${questionText.toLowerCase().includes('why') ? 'the reason behind this goes back to the foundational decisions made early on.' : 'there are several perspectives worth exploring here.'}`,
    },
    {
      hostLine: `That opens up a whole new dimension. Where does this take us next?`,
      guestLine: `Building on that question, I think the most important thing to understand is how this connects to the broader narrative we have been discussing.`,
    },
  ];
}

function createToneWaveBuffer(durationMs: number): Buffer {
  const sampleRate = 16000;
  const totalSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < totalSamples; i += 1) {
    const freq = i % (sampleRate / 2) < sampleRate / 4 ? 440 : 660;
    const amp = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.18;
    buffer.writeInt16LE(Math.floor(amp * 32767), 44 + i * 2);
  }

  return buffer;
}

function createMockInteractiveService(): InteractiveSessionService {
  return {
    async createSession({ userId, topic }) {
      const title = `${toTitleCase(topic)} in Conversation`;
      const summary = `A quick interview-style podcast exploring ${topic}.`;
      const segments = buildMockSegments(topic);
      return createSessionInStore({ userId, topic, title, summary, segments });
    },

    getSession({ sessionId, userId }) {
      return getOwnedSession(sessionId, userId);
    },

    listSessions({ userId }) {
      return getSessionSummariesByUser(userId);
    },

    deleteSession({ sessionId, userId }) {
      return deleteSessionFromStore(sessionId, userId);
    },

    async getSegmentAudio({ sessionId, segmentId, userId }) {
      return getOrGenerateAudio(sessionId, segmentId, userId, async (segment) => {
        try {
          const hostAudio = await synthesizeLine('host', segment.hostLine);
          const guestAudio = await synthesizeLine('guest', segment.guestLine);
          return Buffer.concat([hostAudio, guestAudio]);
        } catch (err) {
          logger.warn({ err, segmentId }, 'Edge TTS failed for segment — falling back to tone');
          const textLength = segment.hostLine.length + segment.guestLine.length;
          const durationMs = Math.min(8000, Math.max(1500, textLength * 15));
          return createToneWaveBuffer(durationMs);
        }
      });
    },

    async processInterrupt({ sessionId, userId, questionText, inputMethod, afterSegmentId, clientRequestId }) {
      const session = getOwnedSession(sessionId, userId);
      if (!session) {
        throw new SessionNotFoundError('Session not found');
      }

      const interrupt = beginInterrupt(session, {
        clientRequestId,
        afterSegmentId,
        questionText,
        inputMethod,
      });

      // If idempotent hit, return current state
      if (session.pendingInterruptId !== interrupt.id) {
        return { session, newSegments: [] };
      }

      try {
        const newSegmentData = buildMockInterruptSegments(questionText, session.topic);
        return completeInterrupt(session, interrupt.id, newSegmentData);
      } catch (error) {
        failInterrupt(session);
        throw error;
      }
    },
  };
}

// ─── Azure Provider ──────────────────────────────────────────────────

function createAzureInteractiveService(): InteractiveSessionService {
  const mockService = createMockInteractiveService();

  return {
    async createSession({ userId, topic }) {
      // For Azure, we would call Azure OpenAI to generate the script
      // For now, reuse mock for text, Azure for audio
      // TODO: Wire Azure OpenAI for interactive segment generation
      return mockService.createSession({ userId, topic });
    },

    getSession: mockService.getSession,
    listSessions: mockService.listSessions,
    deleteSession: mockService.deleteSession,

    async getSegmentAudio({ sessionId, segmentId, userId }) {
      // For Azure, we would use Azure Speech for audio synthesis
      // For now, fall back to mock audio
      return mockService.getSegmentAudio({ sessionId, segmentId, userId });
    },

    async processInterrupt(input) {
      // For Azure, we would use Azure OpenAI to generate continuation
      return mockService.processInterrupt(input);
    },
  };
}

// ─── Shared Helpers ──────────────────────────────────────────────────

function createSessionInStore(params: {
  userId: string;
  topic: string;
  title: string;
  summary: string;
  segments: SegmentScript[];
}): PodcastSession {
  return createSession(params);
}

function deleteSessionFromStore(sessionId: string, userId: string): boolean {
  return deleteSession(sessionId, userId);
}

async function getOrGenerateAudio(
  sessionId: string,
  segmentId: string,
  userId: string,
  generateFn: (segment: PodcastSegment) => Buffer | Promise<Buffer>,
): Promise<Buffer | null> {
  const session = getOwnedSession(sessionId, userId);
  if (!session) {
    return null;
  }

  const segment = session.segments.find((s) => s.id === segmentId);
  if (!segment || segment.status === 'stale') {
    return null;
  }

  // Check cache / disk first
  const cached = getSegmentAudio(segmentId, sessionId);
  if (cached) {
    return cached;
  }

  // Generate audio
  const audio = await generateFn(segment);
  setSegmentAudio(sessionId, segmentId, audio);
  return audio;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createInteractiveSessionService(): InteractiveSessionService {
  const configuredProvider = process.env.PODCAST_PROVIDER?.trim().toLowerCase();

  if (configuredProvider === 'azure') {
    return createAzureInteractiveService();
  }

  return createMockInteractiveService();
}

// ─── Errors ──────────────────────────────────────────────────────────

export class SessionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionNotFoundError';
  }
}

// ─── Utils ───────────────────────────────────────────────────────────

function toTitleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
