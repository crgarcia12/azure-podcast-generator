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
  type StoredAudioSegment,
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
export const PODCAST_TURN_MAX_WORDS = 80;

export type AudienceLevel = 'Beginner' | 'Intermediate' | 'Expert';
export type EpisodeDurationMinutes = 5 | 10 | 15;
export type ConversationStyle = 'Conversational' | 'Educational' | 'Debate';

export interface PodcastGenerationControls {
  audience: AudienceLevel;
  durationMinutes: EpisodeDurationMinutes;
  style: ConversationStyle;
}

interface CreatePodcastInput {
  ownerId: string;
  topic: string;
  controls: PodcastGenerationControls;
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

function recordTiming(
  stage: 'script_generation' | 'initial_audio_ready' | 'question_acknowledged' | 'answer_ready',
  startedAt: number,
  provider: 'azure' | 'mock',
  success: boolean,
): void {
  logger.info(
    { event: 'podcast_provider_timing', stage, durationMs: Date.now() - startedAt, provider, success },
    'Podcast provider stage completed',
  );
}

function createMockPodcastService(): PodcastService {
  const mockHostVoice = process.env.PODCAST_HOST_VOICE?.trim() || DEFAULT_HOST_VOICE;
  const mockGuestVoice = process.env.PODCAST_GUEST_VOICE?.trim() || DEFAULT_GUEST_VOICE;

  return {
    async createEpisode({ ownerId, topic, controls }: CreatePodcastInput): Promise<StoredPodcastEpisode> {
      const scriptStartedAt = Date.now();
      const draftEpisode = createDraftEpisode({
        ownerId,
        topic,
        controls,
        provider: 'mock',
        script: buildMockScript(topic, controls),
      });
      validatePodcastScript(draftEpisode.transcript, controls.durationMinutes);
      recordTiming('script_generation', scriptStartedAt, 'mock', true);
      const audioStartedAt = Date.now();
      const audioBuffer = createToneWaveBuffer(
        2500,
      );
      const audioSegments = buildPendingAudioSegments(draftEpisode.transcript.length);
      audioSegments[0] = {
        ...audioSegments[0],
        status: 'ready',
        audioBuffer,
        audioContentType: 'audio/wav',
      };
      const episode: StoredPodcastEpisode = {
        ...draftEpisode,
        audioBuffer,
        audioContentType: 'audio/wav',
        audioSegments,
      };
      savePodcastEpisode(episode);
      recordTiming('initial_audio_ready', audioStartedAt, 'mock', true);
      setTimeout(() => {
        for (const segment of episode.audioSegments) {
          segment.status = 'ready';
          segment.audioBuffer ??= createToneWaveBuffer(1800);
          segment.audioContentType = 'audio/wav';
        }
        episode.generationStatus = 'ready';
      }, 75);
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

      const acknowledgedAt = Date.now();
      recordTiming('question_acknowledged', acknowledgedAt, 'mock', true);
      if (input.question === '__FAIL_INTERVENTION__' || process.env.MOCK_INTERVENTION_FAIL === 'true') {
        throw new PodcastDependencyError("We couldn't answer that question. Please retry or resume the episode.");
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
      recordTiming('answer_ready', acknowledgedAt, 'mock', true);
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
    async createEpisode({ ownerId, topic, controls }: CreatePodcastInput): Promise<StoredPodcastEpisode> {
      const scriptStartedAt = Date.now();
      const generatedScript = await generateScriptWithAzure(config, topic, controls);
      const draftEpisode = createDraftEpisode({
        ownerId,
        topic,
        controls,
        provider: 'azure',
        script: generatedScript,
      });
      validatePodcastScript(draftEpisode.transcript, controls.durationMinutes);
      recordTiming('script_generation', scriptStartedAt, 'azure', true);

      try {
        const audioStartedAt = Date.now();
        const firstDraft = { ...draftEpisode, transcript: draftEpisode.transcript.slice(0, 2) };
        const audioBuffer = await synthesizeAudioWithAzure(config, firstDraft);
        const audioSegments = buildPendingAudioSegments(draftEpisode.transcript.length);
        audioSegments[0] = {
          ...audioSegments[0],
          status: 'ready',
          audioBuffer,
          audioContentType: 'audio/mpeg',
        };
        const episode: StoredPodcastEpisode = {
          ...draftEpisode,
          audioBuffer,
          audioContentType: 'audio/mpeg',
          audioSegments,
        };
        savePodcastEpisode(episode);
        recordTiming('initial_audio_ready', audioStartedAt, 'azure', true);
        void synthesizeRemainingSegments(config, episode);
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
      const interventionStartedAt = Date.now();
      recordTiming('question_acknowledged', interventionStartedAt, 'azure', true);
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
        controls: episode.controls,
        provider: 'azure',
        generationStatus: 'preparing_audio',
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
      recordTiming('answer_ready', interventionStartedAt, 'azure', true);
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

function buildMockScript(
  topic: string,
  controls: PodcastGenerationControls,
): GeneratedPodcastScript {
  const targetTurns = controls.durationMinutes * 4;
  const level = controls.audience === 'Beginner'
    ? 'We will explain each idea in plain language and define technical terms as they appear.'
    : controls.audience === 'Expert'
      ? 'We will focus on mechanisms, trade-offs, and the evidence behind competing interpretations.'
      : 'We will connect the essential context to concrete examples without assuming specialist knowledge.';
  const style = controls.style === 'Debate'
    ? 'The two perspectives are worth testing against each other rather than forcing an easy consensus.'
    : controls.style === 'Educational'
      ? 'Let us build the explanation one clear step at a time.'
      : 'Let us keep this relaxed and follow the most interesting thread.';
  const turns: GeneratedPodcastScript['turns'] = [];
  const prompts = [
    `Welcome. Today we are exploring ${topic}. ${level}`,
    `${toTitleCase(topic)} matters because it links people, decisions, technology, and consequences that are still visible today.`,
    `Before we jump into details, what is the simplest way to frame the story?`,
    `Start with the problem people were trying to solve, then watch how each solution created a new possibility and a new constraint.`,
    `That is useful. ${style} Which turning point changed the direction most?`,
    `The decisive moment was when an ambitious idea became practical enough to scale. That changed expectations, investment, and who could participate.`,
    `What do people commonly misunderstand when they first learn about this?`,
    `They often remember a single invention or personality. In reality, progress came from teams, experiments, setbacks, regulation, and accumulated know-how.`,
    `So the setbacks are not a side note; they are part of the explanation.`,
    `Exactly. Failures revealed hidden assumptions, and the response to them often shaped standards and better engineering for the next generation.`,
    `Bring that forward to the present. What should listeners notice now?`,
    `Look for the same tension between speed, safety, cost, and public trust. The tools change, but those trade-offs remain remarkably consistent.`,
    `Is there a useful way to compare the competing choices without oversimplifying them?`,
    `Ask what each choice optimized, who carried the risk, and what evidence was available at the time. That makes the disagreement easier to understand.`,
    `I like that because it avoids judging the past with information people did not yet have.`,
    `Right, while still holding decisions accountable. Context explains a choice; it does not automatically excuse its consequences.`,
    `What is one detail that gives the story a more human scale?`,
    `Behind every milestone were ordinary people learning unfamiliar skills, adapting routines, and deciding whether a new system deserved their trust.`,
    `As we close, give us the one idea worth carrying into the next conversation.`,
    `${toTitleCase(topic)} is best understood as an evolving conversation between imagination and constraint. The most durable progress respected both.`,
  ];
  for (let index = 0; index < targetTurns; index += 1) {
    const speaker = index % 2 === 0 ? 'host' : 'guest';
    const base = prompts[index % prompts.length];
    const chapter = Math.floor(index / prompts.length);
    const text = chapter === 0
      ? base
      : `${base} In this part of the story, that pattern helps us connect another stage of ${topic} to the larger picture.`;
    turns.push({
      speaker,
      speakerLabel: speaker === 'host' ? 'Host' : 'Guest',
      voice: speaker === 'host' ? DEFAULT_HOST_VOICE : DEFAULT_GUEST_VOICE,
      text,
    });
  }
  return {
    title: `${toTitleCase(topic)} in Conversation`,
    summary: `An adaptive ${controls.durationMinutes}-minute ${controls.style.toLowerCase()} conversation about ${topic}, designed for a ${controls.audience.toLowerCase()} listener.`,
    turns,
  };
}

function createDraftEpisode({
  ownerId,
  topic,
  script,
  controls,
  provider,
}: {
  ownerId: string;
  topic: string;
  script: GeneratedPodcastScript;
  controls: PodcastGenerationControls;
  provider: 'azure' | 'mock';
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
    controls,
    provider,
    generationStatus: 'preparing_audio',
    createdAt: new Date().toISOString(),
  };
}

async function generateScriptWithAzure(
  config: AzurePodcastConfig,
  topic: string,
  controls: PodcastGenerationControls,
): Promise<GeneratedPodcastScript> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const script = await requestAzureScript(config, topic, controls);
      validatePodcastScript(script.turns, controls.durationMinutes);
      return script;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new PodcastDependencyError('Azure OpenAI returned an invalid podcast script twice.');
}

async function requestAzureScript(
  config: AzurePodcastConfig,
  topic: string,
  controls: PodcastGenerationControls,
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
             content: `You write accurate, natural host-and-guest podcasts for a ${controls.audience} audience in a ${controls.style} style. Target ${controls.durationMinutes} minutes at 130 spoken words per minute.

Rules:
- Return ONLY valid JSON with keys "title", "summary", and "turns"
- "title": a catchy, specific episode title (not generic)
- "summary": 2-3 sentence compelling episode description
- "turns": alternating host and guest, each turn no more than ${PODCAST_TURN_MAX_WORDS} words
- Use short turns, natural transitions, occasional acknowledgements, specific facts, and minimal repetition
- Define terminology for Beginner, balance context and detail for Intermediate, and use precise domain terminology for Expert
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
        max_tokens: Math.min(12000, controls.durationMinutes * 900),
        response_format: { type: 'json_object' },
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

export function validatePodcastScript(
  turns: Array<{ speaker: 'host' | 'guest'; text: string }>,
  durationMinutes: EpisodeDurationMinutes,
): void {
  if (!turns.length || !turns.some((turn) => turn.speaker === 'host') || !turns.some((turn) => turn.speaker === 'guest')) {
    throw new PodcastDependencyError('Podcast script must contain both host and guest turns.');
  }
  let totalWords = 0;
  for (const turn of turns) {
    const words = turn.text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) throw new PodcastDependencyError('Podcast script contains an empty turn.');
    if (words.length > PODCAST_TURN_MAX_WORDS) {
      throw new PodcastDependencyError(`Podcast turn exceeds ${PODCAST_TURN_MAX_WORDS} words.`);
    }
    totalWords += words.length;
  }
  const maximumWords = durationMinutes * 130 * 1.2;
  if (totalWords > maximumWords) {
    throw new PodcastDependencyError('Podcast script substantially exceeds the requested duration.');
  }
}

function buildPendingAudioSegments(turnCount: number): StoredAudioSegment[] {
  const segments: StoredAudioSegment[] = [];
  for (let turnStart = 0; turnStart < turnCount; turnStart += 2) {
    segments.push({
      id: crypto.randomUUID(),
      index: segments.length,
      turnStart,
      turnEnd: Math.min(turnCount, turnStart + 2),
      status: 'pending',
    });
  }
  return segments;
}

async function synthesizeRemainingSegments(
  config: AzurePodcastConfig,
  episode: StoredPodcastEpisode,
): Promise<void> {
  for (const segment of episode.audioSegments.slice(1)) {
    try {
      const audioBuffer = await synthesizeAudioWithAzure(config, {
        ...episode,
        transcript: episode.transcript.slice(segment.turnStart, segment.turnEnd),
      });
      segment.audioBuffer = audioBuffer;
      segment.audioContentType = 'audio/mpeg';
      segment.status = 'ready';
    } catch {
      segment.status = 'failed';
      episode.generationStatus = 'failed';
      return;
    }
  }
  episode.generationStatus = 'ready';
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
    .slice(0, 60);

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
        text: `A listener asks: ${question} Give us the short answer.`,
    },
    {
      id: crypto.randomUUID(),
      speaker: 'guest',
      speakerLabel: 'Guest',
      voice: guestVoice,
        text: `The key is how that question connects to ${topic}. It changed what was practical, reduced an important constraint, and let people operate at a scale that earlier approaches could not support. That is why it mattered beyond the technology itself.`,
    },
    {
      id: crypto.randomUUID(),
      speaker: 'host',
      speakerLabel: 'Host',
      voice: hostVoice,
        text: `Thanks for the question. Let's return to ${lastReference}.`,
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
