import crypto from 'node:crypto';
import { DefaultAzureCredential } from '@azure/identity';
import { logger } from '../logger.js';
import {
  getPodcastEpisodeById,
  getEpisodesByOwner,
  savePodcastEpisode,
  type PodcastEpisodeDraft,
  type StoredPodcastEpisode,
} from '../models/podcast-store.js';

export type { PodcastEpisodeDraft, PodcastTranscriptTurn, StoredPodcastEpisode } from '../models/podcast-store.js';

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

export interface PodcastService {
  createEpisode(input: CreatePodcastInput): Promise<StoredPodcastEpisode>;
  getEpisodeById(input: PodcastLookupInput): Promise<StoredPodcastEpisode | null>;
  listEpisodes(input: PodcastListInput): Promise<StoredPodcastEpisode[]>;
}

export class PodcastConfigurationError extends Error {}

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
  headers.Authorization = `Bearer ${aadToken}`;
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
