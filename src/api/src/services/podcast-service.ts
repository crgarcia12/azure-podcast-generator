import crypto from 'node:crypto';
import { DefaultAzureCredential } from '@azure/identity';
import { logger } from '../logger.js';
import {
  appendSteeredSegment,
  getPodcastEpisodeById,
  getEpisodesByOwner,
  getSteeredSegment,
  savePodcastEpisode,
  type PodcastEpisodeDraft,
  type StoredPodcastEpisode,
  type StoredSteeredSegment,
  type SteeredSegmentTurn,
} from '../models/podcast-store.js';

export type {
  PodcastEpisodeDraft,
  PodcastTranscriptTurn,
  StoredPodcastEpisode,
  StoredSteeredSegment,
  SteeredSegmentTurn,
} from '../models/podcast-store.js';

const DEFAULT_OPENAI_API_VERSION = '2024-10-21';
const DEFAULT_HOST_VOICE = 'en-US-JennyNeural';
const DEFAULT_GUEST_VOICE = 'en-US-GuyNeural';
const AZURE_COGNITIVE_SERVICES_SCOPE = 'https://cognitiveservices.azure.com/.default';

export const PODCAST_TOPIC_MAX_LENGTH = 120;

interface CreatePodcastInput {
  ownerId: string;
  topic: string;
}

interface PodcastLookupInput {
  episodeId: string;
  ownerId: string;
}

interface AzurePodcastBaseConfig {
  openAiApiVersion: string;
  openAiDeployment: string;
  openAiEndpoint: string;
  speechRegion: string;
  hostVoice: string;
  guestVoice: string;
}

interface AzurePodcastApiKeyConfig extends AzurePodcastBaseConfig {
  authMode: 'api-key';
  openAiApiKey: string;
  speechKey: string;
}

interface AzurePodcastManagedIdentityConfig extends AzurePodcastBaseConfig {
  authMode: 'managed-identity';
  speechResourceId: string;
}

type AzurePodcastConfig = AzurePodcastApiKeyConfig | AzurePodcastManagedIdentityConfig;

interface GeneratedPodcastScript {
  title: string;
  summary: string;
  turns: Array<{
    speaker: 'host' | 'guest';
    speakerLabel: 'Host' | 'Guest';
    voice: string;
    text: string;
  }>;
}

interface RawGeneratedPodcastScript {
  title?: unknown;
  summary?: unknown;
  turns?: unknown;
}

interface PodcastListInput {
  ownerId: string;
}

export interface SteerSegmentInput {
  ownerId: string;
  episodeId: string;
  question: string;
  playbackPositionSeconds: number;
}

export interface SteerSegmentLookupInput {
  ownerId: string;
  episodeId: string;
  segmentId: string;
}

export const QUESTION_MIN_LENGTH = 1;
export const QUESTION_MAX_LENGTH = 500;

export interface PodcastService {
  createEpisode(input: CreatePodcastInput): Promise<StoredPodcastEpisode>;
  getEpisodeById(input: PodcastLookupInput): Promise<StoredPodcastEpisode | null>;
  listEpisodes(input: PodcastListInput): Promise<StoredPodcastEpisode[]>;
  generateSteeredSegment(input: SteerSegmentInput): Promise<StoredSteeredSegment>;
  getSteeredSegment(input: SteerSegmentLookupInput): Promise<StoredSteeredSegment | null>;
}

export class PodcastConfigurationError extends Error {}

export class PodcastEpisodeNotFoundError extends Error {
  constructor(message = 'Podcast not found') {
    super(message);
    this.name = 'PodcastEpisodeNotFoundError';
  }
}

export class PodcastDependencyError extends Error {
  constructor(message: string, public readonly draftEpisode?: PodcastEpisodeDraft) {
    super(message);
    this.name = 'PodcastDependencyError';
  }
}

let azureCredential: DefaultAzureCredential | null = null;

export function createPodcastService(): PodcastService {
  const configuredProvider = process.env.PODCAST_PROVIDER?.trim().toLowerCase();
  const hasAnyAzureConfig = [
    process.env.AZURE_OPENAI_API_KEY,
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
    process.env.AZURE_OPENAI_ENDPOINT,
    process.env.AZURE_SPEECH_KEY,
    process.env.AZURE_SPEECH_REGION,
    process.env.AZURE_SPEECH_RESOURCE_ID,
  ].some((value) => Boolean(value));

  if (configuredProvider === 'mock') {
    return createMockPodcastService();
  }

  if (configuredProvider === 'azure' || hasAnyAzureConfig) {
    const azureConfig = readAzureConfig();
    return azureConfig instanceof PodcastConfigurationError
      ? createUnavailablePodcastService(azureConfig)
      : createAzurePodcastService(azureConfig);
  }

  return createMockPodcastService();
}

function createMockPodcastService(): PodcastService {
  const mockHostVoice = process.env.PODCAST_HOST_VOICE?.trim() || DEFAULT_HOST_VOICE;
  const mockGuestVoice = process.env.PODCAST_GUEST_VOICE?.trim() || DEFAULT_GUEST_VOICE;

  return {
    async createEpisode({ ownerId, topic }: CreatePodcastInput): Promise<StoredPodcastEpisode> {
      const draftEpisode = createDraftEpisode({
        ownerId,
        topic,
        script: buildMockScript(topic),
      });
      const audioBuffer = createToneWaveBuffer(
        Math.min(8000, Math.max(2500, draftEpisode.transcript.length * 1200)),
      );
      const episode: StoredPodcastEpisode = {
        ...draftEpisode,
        audioBuffer,
        audioContentType: 'audio/wav',
      };
      savePodcastEpisode(episode);
      return episode;
    },
    async getEpisodeById({ episodeId, ownerId }: PodcastLookupInput): Promise<StoredPodcastEpisode | null> {
      return getOwnedEpisode(episodeId, ownerId);
    },
    async listEpisodes({ ownerId }: PodcastListInput): Promise<StoredPodcastEpisode[]> {
      return getEpisodesByOwner(ownerId);
    },
    async generateSteeredSegment(
      input: SteerSegmentInput,
    ): Promise<StoredSteeredSegment> {
      const episode = getOwnedEpisode(input.episodeId, input.ownerId);
      if (!episode) {
        throw new PodcastEpisodeNotFoundError('Podcast not found');
      }

      const transcriptSoFar = sliceTranscriptByPlayback(episode, input.playbackPositionSeconds);
      const turns = buildMockSteeredTurns({
        topic: episode.topic,
        transcriptSoFar,
        question: input.question,
        hostVoice: mockHostVoice,
        guestVoice: mockGuestVoice,
      });
      const audioBuffer = createToneWaveBuffer(
        Math.min(7000, Math.max(2000, turns.length * 1500)),
      );
      const segment: StoredSteeredSegment = {
        id: crypto.randomUUID(),
        episodeId: episode.id,
        question: input.question,
        playbackPositionSeconds: input.playbackPositionSeconds,
        createdAt: new Date().toISOString(),
        durationSeconds: estimateAudioDurationSeconds(audioBuffer),
        transcript: turns,
        audioBuffer,
        audioContentType: 'audio/wav',
      };
      appendSteeredSegment(episode.id, segment);
      return segment;
    },
    async getSteeredSegment({ episodeId, ownerId, segmentId }) {
      const episode = getOwnedEpisode(episodeId, ownerId);
      if (!episode) {
        return null;
      }
      return getSteeredSegment(episodeId, segmentId) ?? null;
    },
  };
}

function createAzurePodcastService(config: AzurePodcastConfig): PodcastService {
  return {
    async createEpisode({ ownerId, topic }: CreatePodcastInput): Promise<StoredPodcastEpisode> {
      const generatedScript = await generateScriptWithAzure(config, topic);
      const draftEpisode = createDraftEpisode({
        ownerId,
        topic,
        script: generatedScript,
      });

      try {
        const audioBuffer = await synthesizeAudioWithAzure(config, draftEpisode);
        const episode: StoredPodcastEpisode = {
          ...draftEpisode,
          audioBuffer,
          audioContentType: 'audio/mpeg',
        };
        savePodcastEpisode(episode);
        return episode;
      } catch (error) {
        if (error instanceof PodcastDependencyError) {
          throw new PodcastDependencyError(error.message, draftEpisode);
        }

        throw new PodcastDependencyError(
          'Audio generation failed. The script is ready, but speech synthesis is currently unavailable.',
          draftEpisode,
        );
      }
    },
    async getEpisodeById({ episodeId, ownerId }: PodcastLookupInput): Promise<StoredPodcastEpisode | null> {
      return getOwnedEpisode(episodeId, ownerId);
    },
    async listEpisodes({ ownerId }: PodcastListInput): Promise<StoredPodcastEpisode[]> {
      return getEpisodesByOwner(ownerId);
    },
    async generateSteeredSegment(
      input: SteerSegmentInput,
    ): Promise<StoredSteeredSegment> {
      const episode = getOwnedEpisode(input.episodeId, input.ownerId);
      if (!episode) {
        throw new PodcastEpisodeNotFoundError('Podcast not found');
      }

      const transcriptSoFar = sliceTranscriptByPlayback(episode, input.playbackPositionSeconds);
      const turns = await generateSteeredTurnsWithAzure({
        config,
        topic: episode.topic,
        transcriptSoFar,
        question: input.question,
      });
      const segmentDraft: PodcastEpisodeDraft = {
        id: crypto.randomUUID(),
        ownerId: episode.ownerId,
        topic: episode.topic,
        title: 'Listener question',
        summary: input.question,
        transcript: turns.map((turn) => ({
          id: crypto.randomUUID(),
          speaker: turn.speaker,
          speakerLabel: turn.speakerLabel,
          voice: turn.voice,
          text: turn.text,
        })),
        createdAt: new Date().toISOString(),
      };

      const audioBuffer = await synthesizeAudioWithAzure(config, segmentDraft);
      const segment: StoredSteeredSegment = {
        id: segmentDraft.id,
        episodeId: episode.id,
        question: input.question,
        playbackPositionSeconds: input.playbackPositionSeconds,
        createdAt: segmentDraft.createdAt,
        durationSeconds: estimateAudioDurationSeconds(audioBuffer),
        transcript: segmentDraft.transcript.map((turn) => ({
          id: turn.id,
          speaker: turn.speaker,
          speakerLabel: turn.speakerLabel,
          voice: turn.voice,
          text: turn.text,
        })),
        audioBuffer,
        audioContentType: 'audio/mpeg',
      };
      appendSteeredSegment(episode.id, segment);
      return segment;
    },
    async getSteeredSegment({ episodeId, ownerId, segmentId }) {
      const episode = getOwnedEpisode(episodeId, ownerId);
      if (!episode) {
        return null;
      }
      return getSteeredSegment(episodeId, segmentId) ?? null;
    },
  };
}

function createUnavailablePodcastService(error: PodcastConfigurationError): PodcastService {
  return {
    async createEpisode(): Promise<StoredPodcastEpisode> {
      throw error;
    },
    async getEpisodeById(): Promise<StoredPodcastEpisode | null> {
      return null;
    },
    async listEpisodes(): Promise<StoredPodcastEpisode[]> {
      return [];
    },
    async generateSteeredSegment(): Promise<StoredSteeredSegment> {
      throw error;
    },
    async getSteeredSegment(): Promise<StoredSteeredSegment | null> {
      return null;
    },
  };
}

function getOwnedEpisode(episodeId: string, ownerId: string): StoredPodcastEpisode | null {
  const episode = getPodcastEpisodeById(episodeId);
  if (!episode || episode.ownerId !== ownerId) {
    return null;
  }

  return episode;
}

function readAzureConfig(): AzurePodcastConfig | PodcastConfigurationError {
  const openAiEndpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const openAiApiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
  const openAiDeployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME?.trim();
  const speechKey = process.env.AZURE_SPEECH_KEY?.trim();
  const speechRegion = process.env.AZURE_SPEECH_REGION?.trim();
  const speechResourceId = process.env.AZURE_SPEECH_RESOURCE_ID?.trim();

  if (!openAiEndpoint || !openAiDeployment || !speechRegion) {
    return new PodcastConfigurationError(
      'Podcast generation is not configured yet. Set Azure OpenAI and Azure Speech settings before using this feature.',
    );
  }

  const baseConfig: AzurePodcastBaseConfig = {
    openAiApiVersion: process.env.AZURE_OPENAI_API_VERSION?.trim() || DEFAULT_OPENAI_API_VERSION,
    openAiDeployment,
    openAiEndpoint: openAiEndpoint.replace(/\/$/, ''),
    speechRegion,
    hostVoice: process.env.PODCAST_HOST_VOICE?.trim() || DEFAULT_HOST_VOICE,
    guestVoice: process.env.PODCAST_GUEST_VOICE?.trim() || DEFAULT_GUEST_VOICE,
  };

  if (openAiApiKey && speechKey) {
    return {
      ...baseConfig,
      authMode: 'api-key',
      openAiApiKey,
      speechKey,
    };
  }

  if (speechResourceId) {
    return {
      ...baseConfig,
      authMode: 'managed-identity',
      speechResourceId,
    };
  }

  return new PodcastConfigurationError(
    'Podcast generation is missing Azure credentials. Configure API keys or provide AZURE_SPEECH_RESOURCE_ID for managed identity.',
  );
}

function buildMockScript(topic: string): GeneratedPodcastScript {
  return {
    title: `${toTitleCase(topic)} in Conversation`,
    summary: `A quick interview-style podcast exploring ${topic}.`,
    turns: [
      {
        speaker: 'host',
        speakerLabel: 'Host',
        voice: DEFAULT_HOST_VOICE,
        text: `Welcome back. Today we are diving into ${topic}, and I want to unpack why this story still matters.`,
      },
      {
        speaker: 'guest',
        speakerLabel: 'Guest',
        voice: DEFAULT_GUEST_VOICE,
        text: `${toTitleCase(topic)} is a strong podcast topic because it mixes history, personalities, and the decisions that changed an industry.`,
      },
      {
        speaker: 'host',
        speakerLabel: 'Host',
        voice: DEFAULT_HOST_VOICE,
        text: `Set the scene for us. What is the first thing a listener should understand before the timeline gets complicated?`,
      },
      {
        speaker: 'guest',
        speakerLabel: 'Guest',
        voice: DEFAULT_GUEST_VOICE,
        text: `Start with the early context, then connect the big milestones, and finally explain how those moments still shape the present-day conversation.`,
      },
      {
        speaker: 'host',
        speakerLabel: 'Host',
        voice: DEFAULT_HOST_VOICE,
        text: `That gives us the backbone. What is the biggest takeaway a listener should keep in mind at the end of the episode?`,
      },
      {
        speaker: 'guest',
        speakerLabel: 'Guest',
        voice: DEFAULT_GUEST_VOICE,
        text: `The biggest takeaway is that ${topic} is not just a sequence of facts. It is a story about decisions, trade-offs, and long-term consequences.`,
      },
    ],
  };
}

function createDraftEpisode({
  ownerId,
  topic,
  script,
}: {
  ownerId: string;
  topic: string;
  script: GeneratedPodcastScript;
}): PodcastEpisodeDraft {
  return {
    id: crypto.randomUUID(),
    ownerId,
    topic,
    title: script.title,
    summary: script.summary,
    transcript: script.turns.map((turn) => ({
      id: crypto.randomUUID(),
      speaker: turn.speaker,
      speakerLabel: turn.speakerLabel,
      voice: turn.voice,
      text: turn.text,
    })),
    createdAt: new Date().toISOString(),
  };
}

async function generateScriptWithAzure(
  config: AzurePodcastConfig,
  topic: string,
): Promise<GeneratedPodcastScript> {
  const headers = await getAzureOpenAiHeaders(config);
  const response = await fetch(
    `${config.openAiEndpoint}/openai/deployments/${encodeURIComponent(config.openAiDeployment)}/chat/completions?api-version=${encodeURIComponent(config.openAiApiVersion)}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: `You are a professional podcast script writer who creates engaging, natural-sounding interview-style podcast episodes. Your scripts should feel like a real conversation between a knowledgeable host and an expert guest.

Rules:
- Return ONLY valid JSON with keys "title", "summary", and "turns"
- "title": a catchy, specific episode title (not generic)
- "summary": 2-3 sentence compelling episode description
- "turns": array of 10-12 items alternating host and guest
- Each turn has "speaker" ("host" or "guest") and "text" (2-4 natural sentences)
- The host asks probing questions, sets context, and guides the conversation
- The guest provides expert insights, anecdotes, and specific examples
- Include natural conversational elements: reactions, follow-ups, occasional humor
- Build narrative arc: hook → context → deep dive → surprising insight → takeaway
- Do NOT wrap the response in markdown fences or add any text outside the JSON`,
          },
          {
            role: 'user',
            content: `Create a podcast episode script about: ${topic}`,
          },
        ],
        temperature: 0.8,
        max_tokens: 3000,
      }),
    },
  );

  if (!response.ok) {
    const responseBody = await response.text();
    throw new PodcastDependencyError(
      `Script generation failed with Azure OpenAI (${response.status}). ${responseBody.slice(0, 200)}`,
    );
  }

  const body = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const rawContent = body.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new PodcastDependencyError('Azure OpenAI returned an empty script response.');
  }

  return normaliseGeneratedScript(rawContent, config.hostVoice, config.guestVoice);
}

async function synthesizeAudioWithAzure(
  config: AzurePodcastConfig,
  episode: PodcastEpisodeDraft,
): Promise<Buffer> {
  const ssml = buildSpeechSsml(episode);
  const headers = await getAzureSpeechHeaders(config);
  const response = await fetch(
    `https://${config.speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers,
      body: ssml,
    },
  );

  if (!response.ok) {
    const responseBody = await response.text();
    logger.error(
      { status: response.status, body: responseBody.slice(0, 500), region: config.speechRegion },
      'Azure Speech synthesis failed',
    );
    throw new PodcastDependencyError(
      `Speech synthesis failed with Azure Speech (${response.status}). ${responseBody.slice(0, 200)}`,
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

async function getAzureOpenAiHeaders(config: AzurePodcastConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.authMode === 'api-key') {
    headers['api-key'] = config.openAiApiKey;
    return headers;
  }

  headers.Authorization = `Bearer ${await getAzureAccessToken()}`;
  return headers;
}

async function getAzureSpeechHeaders(config: AzurePodcastConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/ssml+xml',
    'User-Agent': 'azure-podcast-generator',
    'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
  };

  if (config.authMode === 'api-key') {
    headers['Ocp-Apim-Subscription-Key'] = config.speechKey;
    return headers;
  }

  const aadToken = await getAzureAccessToken();
  headers.Authorization = `Bearer ${buildAzureSpeechAuthorizationToken(config.speechResourceId, aadToken)}`;
  return headers;
}

async function getAzureAccessToken(): Promise<string> {
  azureCredential ??= new DefaultAzureCredential();
  const token = await azureCredential.getToken(AZURE_COGNITIVE_SERVICES_SCOPE);

  if (!token?.token) {
    throw new PodcastDependencyError('Managed identity authentication for Azure AI did not return an access token.');
  }

  return token.token;
}

export function buildAzureSpeechAuthorizationToken(resourceId: string, aadToken: string): string {
  return `aad#${resourceId}#${aadToken}`;
}

function normaliseGeneratedScript(
  rawContent: string,
  hostVoice: string,
  guestVoice: string,
): GeneratedPodcastScript {
  const jsonText = extractJsonObject(rawContent);
  const parsed = JSON.parse(jsonText) as RawGeneratedPodcastScript;
  const title = typeof parsed.title === 'string' && parsed.title.trim().length > 0
    ? parsed.title.trim()
    : 'Generated podcast episode';
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
    ? parsed.summary.trim()
    : 'A generated interview-style podcast episode.';

  if (!Array.isArray(parsed.turns)) {
    throw new PodcastDependencyError('Azure OpenAI returned a script without podcast turns.');
  }

  const turns = parsed.turns
    .filter(
      (turn): turn is { speaker?: unknown; text?: unknown } =>
        typeof turn === 'object' && turn !== null,
    )
    .map((turn, index) => {
      const text = typeof turn.text === 'string' ? turn.text.trim() : '';
      if (!text) {
        return null;
      }

      const speaker: 'host' | 'guest' = index % 2 === 0 ? 'host' : 'guest';
      const speakerLabel: 'Host' | 'Guest' = speaker === 'host' ? 'Host' : 'Guest';
      return {
        speaker,
        speakerLabel,
        voice: speaker === 'host' ? hostVoice : guestVoice,
        text,
      };
    })
    .filter((turn): turn is NonNullable<typeof turn> => turn !== null)
    .slice(0, 14);

  if (turns.length < 4) {
    throw new PodcastDependencyError('Azure OpenAI returned too few valid turns for the podcast.');
  }

  return { title, summary, turns };
}

function extractJsonObject(rawContent: string): string {
  const firstBrace = rawContent.indexOf('{');
  const lastBrace = rawContent.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    throw new PodcastDependencyError('Azure OpenAI returned a response that could not be parsed as JSON.');
  }

  return rawContent.slice(firstBrace, lastBrace + 1);
}

function buildSpeechSsml(episode: PodcastEpisodeDraft): string {
  const segments = episode.transcript
    .map((turn, index) => {
      const escapedText = escapeXml(turn.text);
      const pause = index > 0 ? '<break time="400ms"/>' : '';
      return `<voice name="${turn.voice}">${pause}<prosody rate="0%">${escapedText}</prosody></voice>`;
    })
    .join('');

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">${segments}</speak>`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function toTitleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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

  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
    const frequency = sampleIndex % (sampleRate / 2) < sampleRate / 4 ? 440 : 660;
    const amplitude = Math.sin((2 * Math.PI * frequency * sampleIndex) / sampleRate) * 0.18;
    buffer.writeInt16LE(Math.floor(amplitude * 32767), 44 + sampleIndex * 2);
  }

  return buffer;
}

const SPEECH_WORDS_PER_SECOND = 2.5;

function turnDurationSeconds(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.5, wordCount / SPEECH_WORDS_PER_SECOND);
}

export function sliceTranscriptByPlayback(
  episode: StoredPodcastEpisode,
  playbackPositionSeconds: number,
): StoredPodcastEpisode['transcript'] {
  if (!Number.isFinite(playbackPositionSeconds) || playbackPositionSeconds <= 0) {
    return [];
  }

  const result: StoredPodcastEpisode['transcript'] = [];
  let cumulative = 0;

  for (const turn of episode.transcript) {
    const duration = turnDurationSeconds(turn.text);
    if (cumulative >= playbackPositionSeconds) {
      break;
    }
    result.push(turn);
    cumulative += duration;
  }

  return result;
}

function buildMockSteeredTurns({
  topic,
  transcriptSoFar,
  question,
  hostVoice,
  guestVoice,
}: {
  topic: string;
  transcriptSoFar: StoredPodcastEpisode['transcript'];
  question: string;
  hostVoice: string;
  guestVoice: string;
}): SteeredSegmentTurn[] {
  const lastReference = transcriptSoFar.length
    ? `the thread we were just exploring`
    : `the heart of ${topic}`;

  return [
    {
      id: crypto.randomUUID(),
      speaker: 'host',
      speakerLabel: 'Host',
      voice: hostVoice,
      text: `Hold that thought — a listener just sent in a great question. They want to know: ${question} Let's hand that one to our guest.`,
    },
    {
      id: crypto.randomUUID(),
      speaker: 'guest',
      speakerLabel: 'Guest',
      voice: guestVoice,
      text: `That's a fantastic question — ${question} Here's the short version: it's a thought experiment that sits right at the edge of what general relativity allows. Each eye crosses the event horizon at a slightly different moment, but because no signal can climb back out, the brain stops receiving anything from the eye that crossed first — so the picture you experience is exactly what light from outside the black hole still reaches you, until your second eye crosses too. There's no dramatic split-screen — just an ordinary view that ends, on each side, at slightly different instants.`,
    },
    {
      id: crypto.randomUUID(),
      speaker: 'host',
      speakerLabel: 'Host',
      voice: hostVoice,
      text: `Brilliant — thanks for asking that. Let's pick up ${lastReference} and keep going from where we left off in this episode about ${topic}.`,
    },
  ];
}

interface AzureSteerInput {
  config: AzurePodcastConfig;
  topic: string;
  transcriptSoFar: StoredPodcastEpisode['transcript'];
  question: string;
}

async function generateSteeredTurnsWithAzure({
  config,
  topic,
  transcriptSoFar,
  question,
}: AzureSteerInput): Promise<SteeredSegmentTurn[]> {
  const headers = await getAzureOpenAiHeaders(config);
  const transcriptText = transcriptSoFar
    .map((turn) => `${turn.speakerLabel}: ${turn.text}`)
    .join('\n');

  const response = await fetch(
    `${config.openAiEndpoint}/openai/deployments/${encodeURIComponent(config.openAiDeployment)}/chat/completions?api-version=${encodeURIComponent(config.openAiApiVersion)}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: `You produce short interjection segments for an interview-style podcast. A listener has asked a question mid-episode. Respond with strict JSON {"turns":[{"speaker":"host|guest","text":"…"}, …]} containing exactly three turns in this order: (1) the host acknowledges the listener question and redirects to the guest, (2) the guest answers the question naturally and concretely, (3) the host bridges back to the topic so the original interview can continue. Do not wrap the JSON in markdown.`,
          },
          {
            role: 'user',
            content: `Topic: ${topic}\nTranscript so far:\n${transcriptText}\n\nListener question: ${question}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 800,
      }),
    },
  );

  if (!response.ok) {
    const responseBody = await response.text();
    throw new PodcastDependencyError(
      `Steered segment generation failed with Azure OpenAI (${response.status}). ${responseBody.slice(0, 200)}`,
    );
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent = body.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new PodcastDependencyError('Azure OpenAI returned an empty steered segment response.');
  }

  const jsonText = extractJsonObject(rawContent);
  const parsed = JSON.parse(jsonText) as { turns?: unknown };
  if (!Array.isArray(parsed.turns) || parsed.turns.length < 3) {
    throw new PodcastDependencyError('Azure OpenAI returned an invalid steered segment.');
  }

  const turns: SteeredSegmentTurn[] = [];
  for (const [index, raw] of parsed.turns.entries()) {
    if (typeof raw !== 'object' || raw === null) continue;
    const turn = raw as { speaker?: unknown; text?: unknown };
    const text = typeof turn.text === 'string' ? turn.text.trim() : '';
    if (!text) continue;

    let speaker: 'host' | 'guest';
    if (turn.speaker === 'host' || turn.speaker === 'guest') {
      speaker = turn.speaker;
    } else {
      speaker = index === 1 ? 'guest' : 'host';
    }

    const speakerLabel: 'Host' | 'Guest' = speaker === 'host' ? 'Host' : 'Guest';
    turns.push({
      id: crypto.randomUUID(),
      speaker,
      speakerLabel,
      voice: speaker === 'host' ? config.hostVoice : config.guestVoice,
      text,
    });
  }

  if (turns.length < 3) {
    throw new PodcastDependencyError('Azure OpenAI returned too few turns for the steered segment.');
  }

  // Enforce the host → guest → host arc structurally.
  const first = turns[0];
  const last = turns[turns.length - 1];
  first.speaker = 'host';
  first.speakerLabel = 'Host';
  first.voice = config.hostVoice;
  last.speaker = 'host';
  last.speakerLabel = 'Host';
  last.voice = config.hostVoice;

  return turns;
}

function estimateAudioDurationSeconds(buffer: Buffer): number {
  if (buffer.length < 44 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF') {
    // Fallback estimate for non-WAV (e.g. mp3 from Azure): 16 kbps * sane factor.
    return Math.max(2, Math.round(buffer.length / 16000));
  }

  const byteRate = buffer.readUInt32LE(28);
  const dataSize = buffer.readUInt32LE(40);
  if (!byteRate) {
    return Math.max(2, Math.round(dataSize / 32000));
  }
  return Math.max(1, dataSize / byteRate);
}
