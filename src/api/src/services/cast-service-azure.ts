// Azure OpenAI-backed beat provider for the cast service. Generates outline
// and listener-question answer beats by calling chat completions on the
// configured Azure OpenAI deployment, using a federated managed identity
// (see k8s-aad-credential.ts) for auth so we never need to ship API keys
// or rely on the workload-identity webhook (which can't be configured on
// the Liliput-managed Deployment).
//
// The provider degrades gracefully: if the LLM returns malformed JSON or
// the call fails entirely, the cast service falls back to the mock template
// so a transient outage never breaks user sessions.

import type { TokenCredential } from '@azure/core-auth';
import type { BeatProvider, CastSegment, PlannedBeat } from './cast-service.js';
import { K8sFederatedAadCredential } from './k8s-aad-credential.js';

const AZURE_COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default';
const DEFAULT_API_VERSION = '2024-10-21';

interface AzureBeatProviderConfig {
  endpoint: string;
  deploymentName: string;
  apiVersion?: string;
  credential: TokenCredential;
  modelDisplayName?: string;
  // Allow tests to inject a fake fetch.
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
}

function normaliseEndpoint(endpoint: string): string {
  return endpoint.replace(/\/$/, '');
}

function buildOutlineSystemPrompt(topic: string, style: string): string {
  const stylePart = style
    ? ` The producer asked for the following vibe: "${style}". Honour that vibe in pacing, vocabulary, and the angles you choose.`
    : '';
  return [
    'You are scripting an interview-style podcast about ' + topic + '.',
    'Cast: Riley (host, warm and curious) interviews Sam (subject-matter expert).',
    stylePart.trim(),
    'Generate 10 to 12 alternating beats covering: warm welcome, basics, origin, turning points, key people, real-world impact, common misconceptions, what is next, where listeners can go deeper, the takeaway, and the wrap-up.',
    'Each beat is one host line (1 to 2 sentences asking) and one guest line (2 to 4 sentences answering with concrete substance — facts, examples, opinions).',
    'Open the very first beat with "Welcome back to the show." so listeners hear a familiar handoff.',
    'Avoid generic filler. Ground every beat in the topic. Speak as if to a smart commuter listening on a drive — confident, specific, no fluff.',
    'Return ONLY a single JSON object of the form {"beats":[{"hostLine":"...","guestLine":"..."},...]} with no markdown fences and no commentary.',
  ].filter(Boolean).join('\n');
}

function buildAnswerSystemPrompt(topic: string, style: string): string {
  const stylePart = style ? ` Honour the vibe: "${style}".` : '';
  return [
    'You are continuing an in-progress interview-style podcast about ' + topic + '.',
    'A listener has just sent in a question. Generate exactly 4 alternating beats that interrupt the show to address it, then hand back to the main thread.',
    'Beat 1: host pauses and quotes the listener question verbatim, including the word "listener", and redirects to the guest.',
    'Beat 2: guest engages with the question and frames the angle.',
    'Beat 3: guest delivers the substantive answer with concrete reasoning.',
    'Beat 4: host thanks the listener briefly and returns the show to the next outline beat (the guest line in beat 4 should be a short re-entry like "Yes, let us pick it up.").',
    stylePart.trim(),
    'Return ONLY a single JSON object of the form {"beats":[{"hostLine":"...","guestLine":"..."},{...},{...},{...}]} with no markdown fences and no commentary.',
  ].filter(Boolean).join('\n');
}

// Strip ```json fences if the model decides to add them despite instructions.
function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    return stripped.trim();
  }
  // Find the first { and last } to be tolerant of leading/trailing prose.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return trimmed;
  return trimmed.slice(first, last + 1);
}

function parseBeats(raw: string): PlannedBeat[] {
  const json = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Azure OpenAI returned non-JSON response: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Azure OpenAI response was not a JSON object');
  }
  const beats = (parsed as { beats?: unknown }).beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new Error('Azure OpenAI response did not contain a non-empty "beats" array');
  }
  return beats.map((b, i) => {
    if (!b || typeof b !== 'object') {
      throw new Error(`Beat ${i} was not an object`);
    }
    const beat = b as Record<string, unknown>;
    const hostLine = typeof beat.hostLine === 'string' ? beat.hostLine.trim() : '';
    const guestLine = typeof beat.guestLine === 'string' ? beat.guestLine.trim() : '';
    if (!hostLine || !guestLine) {
      throw new Error(`Beat ${i} missing hostLine or guestLine`);
    }
    return { hostLine, guestLine };
  });
}

export function createAzureBeatProvider(config: AzureBeatProviderConfig): BeatProvider {
  const endpoint = normaliseEndpoint(config.endpoint);
  const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(config.deploymentName)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const modelDisplayName = config.modelDisplayName ?? `${config.deploymentName} (Azure OpenAI)`;
  const fetchImpl = config.fetchImpl ?? fetch;

  async function callChat(messages: Array<{ role: string; content: string }>): Promise<string> {
    const accessToken = await config.credential.getToken(AZURE_COGNITIVE_SCOPE);
    if (!accessToken) {
      throw new Error('Azure credential returned no access token');
    }
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        temperature: 0.75,
        max_tokens: 2200,
        response_format: { type: 'json_object' },
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Azure OpenAI chat completion failed (${response.status}): ${text.slice(0, 400)}`);
    }
    let parsed: ChatCompletionResponse;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`Azure OpenAI returned non-JSON envelope: ${(err as Error).message}`);
    }
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Azure OpenAI returned an empty completion');
    }
    return content;
  }

  return {
    providerName: 'azure-openai',
    modelDisplayName,
    buildSystemPrompt(topic: string, style: string): string {
      // Surface the outline prompt to the user — that's the one that shapes
      // the show as a whole. Answer prompts are constructed per-question.
      return buildOutlineSystemPrompt(topic, style);
    },
    async buildOutline(topic: string, style: string): Promise<PlannedBeat[]> {
      const sys = buildOutlineSystemPrompt(topic, style);
      const user = `Topic: ${topic}\nStyle: ${style || '(no specific style requested — use a confident, friendly default)'}`;
      const content = await callChat([
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ]);
      return parseBeats(content);
    },
    async buildAnswerBeats(input: {
      topic: string;
      style: string;
      question: string;
      transcriptSoFar: CastSegment[];
    }): Promise<PlannedBeat[]> {
      const sys = buildAnswerSystemPrompt(input.topic, input.style);
      // Give the model the last few segments so the answer can riff on the
      // running thread instead of feeling teleported in. Cap to keep prompt
      // size predictable.
      const tail = input.transcriptSoFar.slice(-10);
      const transcriptBlock = tail.length
        ? tail.map((s) => `${s.speaker === 'host' ? 'Host' : 'Guest'}: ${s.text}`).join('\n')
        : '(show has not started yet — this is the first listener question)';
      const user = [
        `Topic: ${input.topic}`,
        `Style: ${input.style || '(default)'}`,
        '',
        'Recent transcript:',
        transcriptBlock,
        '',
        `Listener question (quote verbatim in beat 1): ${input.question}`,
      ].join('\n');
      const content = await callChat([
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ]);
      return parseBeats(content);
    },
  };
}

// Returns an Azure-backed provider if the env is fully configured, otherwise
// null so the caller can fall back to the mock provider. The set of required
// env vars is documented in src/api/Dockerfile.
export function createAzureBeatProviderFromEnv(): BeatProvider | null {
  if ((process.env.LLM_PROVIDER || '').toLowerCase() !== 'azure') return null;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME?.trim();
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim() || DEFAULT_API_VERSION;
  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  const clientId = (process.env.AZURE_OPENAI_CLIENT_ID || process.env.AZURE_CLIENT_ID)?.trim();

  if (!endpoint || !deployment || !tenantId || !clientId) return null;

  const credential = new K8sFederatedAadCredential({
    tenantId,
    clientId,
    serviceAccountName: process.env.AZURE_SERVICE_ACCOUNT?.trim() || 'default',
  });

  return createAzureBeatProvider({
    endpoint,
    deploymentName: deployment,
    apiVersion,
    credential,
    modelDisplayName: process.env.AZURE_OPENAI_MODEL_DISPLAY_NAME?.trim()
      || `${deployment} (Azure OpenAI)`,
  });
}
