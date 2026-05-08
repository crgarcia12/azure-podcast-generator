// Azure OpenAI-backed beat provider for the cast service. Generates outline
// and listener-question answer beats by calling chat completions on the
// configured Azure OpenAI deployment.
//
// Authentication preference, in order:
//   1. `ClientSecretCredential` (AZURE_TENANT_ID / AZURE_CLIENT_ID /
//      AZURE_CLIENT_SECRET) — populated from the in-cluster Kubernetes
//      Secret `liliput-azure-sp` by `azure-secret-bootstrap.ts`. This is
//      the standard, sanctioned path on Liliput previews.
//   2. `K8sFederatedAadCredential` — legacy workload-identity-by-hand
//      flow, kept as a fallback for environments where the per-repo SP
//      isn't projected (e.g. local dev with `az login`).
//
// The provider degrades gracefully: if the LLM returns malformed JSON or
// the call fails entirely, the cast service falls back to the mock template
// so a transient outage never breaks user sessions.

import type { TokenCredential } from '@azure/core-auth';
import { ClientSecretCredential } from '@azure/identity';
import type { BeatProvider, CastSegment, PlannedBeat } from './cast-service.js';
import { K8sFederatedAadCredential } from './k8s-aad-credential.js';
import { logger } from '../logger.js';

const AZURE_COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default';
// 2024-10-21 is the latest GA api-version that's available on the
// `crgar-liliput-ai` resource and supports `max_completion_tokens` —
// the parameter that gpt-5 / o-series reasoning models require in
// place of the legacy `max_tokens`.
const DEFAULT_API_VERSION = '2024-10-21';

// Reasoning-class deployments require `max_completion_tokens` and reject
// `temperature` (only the default 1.0 is supported). We send the request
// body shaped for the model class so a single image works for both
// classic chat models (gpt-4o-mini, etc.) and the new reasoning models
// (gpt-5, gpt-5-mini, o1, o3, o4).
function isReasoningModel(deployment: string): boolean {
  const d = deployment.toLowerCase();
  return /^(gpt-5|o1|o3|o4|chatgpt-5)/.test(d);
}

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
    finish_reason?: string;
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
  const modelDisplayName = config.modelDisplayName ?? `${config.deploymentName} (Azure OpenAI)`;
  const fetchImpl = config.fetchImpl ?? fetch;

  async function callChat(
    messages: Array<{ role: string; content: string }>,
    deploymentOverride?: string,
  ): Promise<string> {
    const accessToken = await config.credential.getToken(AZURE_COGNITIVE_SCOPE);
    if (!accessToken) {
      throw new Error('Azure credential returned no access token');
    }
    // Per-session deployment override lets a listener target a different
    // model (e.g. gpt-4o-mini vs gpt-4o) without restarting the pod. URL is
    // recomputed per-call instead of cached so an override doesn't leak into
    // sessions that didn't ask for one.
    const targetDeployment = deploymentOverride?.trim() || config.deploymentName;
    const targetUrl = `${endpoint}/openai/deployments/${encodeURIComponent(targetDeployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

    // Reasoning-class models (gpt-5*, o-series) want `max_completion_tokens`
    // and reject `temperature`. Older chat models accept either, but we
    // standardise on `max_completion_tokens` since the 2024-10-21 GA API
    // supports it everywhere on this resource.
    //
    // For reasoning models we also force `reasoning_effort: 'minimal'`.
    // gpt-5 at default ("medium") effort can burn 3000-4000 hidden
    // reasoning tokens before producing visible output, which:
    //   • blows our token budget → `finish_reason: "length"` + empty body
    //   • adds 60+ seconds of latency per call
    // Podcast-script generation is a creative-writing task, not a math
    // problem — minimal/zero reasoning produces equal-quality output in
    // ~20s instead of 80s. Empirically (probed against gpt-5 on
    // crgar-liliput-ai): minimal effort returns 1500-token JSON in 20s
    // with 0 reasoning tokens; default effort returns 6000-token JSON
    // in 80s with 3800 reasoning tokens.
    const reasoning = isReasoningModel(targetDeployment);
    const requestBody: Record<string, unknown> = {
      messages,
      max_completion_tokens: reasoning ? 6000 : 2200,
      response_format: { type: 'json_object' },
    };
    if (reasoning) {
      requestBody.reasoning_effort = 'minimal';
    } else {
      requestBody.temperature = 0.75;
    }

    const response = await fetchImpl(targetUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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
      const finishReason = parsed.choices?.[0]?.finish_reason;
      throw new Error(
        `Azure OpenAI returned an empty completion (finish_reason=${finishReason ?? 'unknown'}). ` +
        'For reasoning models this usually means max_completion_tokens was exhausted by the hidden reasoning trace.',
      );
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
    async buildOutline(input): Promise<PlannedBeat[]> {
      const { topic, style, systemPromptOverride, deploymentOverride } = input;
      // Listener override wins over the canned prompt. We append topic/style
      // as a user message in either case so the listener doesn't have to
      // remember to put them in their custom prompt.
      const sys = systemPromptOverride?.trim() || buildOutlineSystemPrompt(topic, style);
      const user = `Topic: ${topic}\nStyle: ${style || '(no specific style requested — use a confident, friendly default)'}\n\nReturn ONLY a single JSON object of the form {"beats":[{"hostLine":"...","guestLine":"..."},...]} with 10 to 12 alternating beats. Each beat is one host line and one guest line. Open the very first beat with "Welcome back to the show.".`;
      const content = await callChat([
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ], deploymentOverride);
      return parseBeats(content);
    },
    async buildAnswerBeats(input: {
      topic: string;
      style: string;
      question: string;
      transcriptSoFar: CastSegment[];
      systemPromptOverride?: string;
      deploymentOverride?: string;
    }): Promise<PlannedBeat[]> {
      // For the answer flow we keep using the canned answer-system-prompt even
      // when a custom outline prompt was supplied — the answer shape (4-beat
      // interruption that quotes the listener verbatim) is structural, not
      // stylistic, and overriding it would break the listener experience.
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
      ], input.deploymentOverride);
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
  const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();

  if (!endpoint || !deployment || !tenantId || !clientId) return null;

  // Prefer the per-repo service-principal client secret (standard SDK path)
  // over the homemade workload-identity flow. Falls back to the federated
  // credential when the projected K8s Secret hasn't landed yet — that keeps
  // the cast service working in environments where Liliput's
  // app-registration tooling hasn't been run.
  let credential: TokenCredential;
  let credentialName: 'client-secret' | 'k8s-federated';
  if (clientSecret) {
    credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    credentialName = 'client-secret';
  } else {
    credential = new K8sFederatedAadCredential({
      tenantId,
      clientId,
      serviceAccountName: process.env.AZURE_SERVICE_ACCOUNT?.trim() || 'default',
    });
    credentialName = 'k8s-federated';
  }

  logger.info(
    { endpoint, deployment, apiVersion, credential: credentialName },
    'cast-service-azure: real Azure OpenAI provider configured',
  );

  return createAzureBeatProvider({
    endpoint,
    deploymentName: deployment,
    apiVersion,
    credential,
    modelDisplayName: process.env.AZURE_OPENAI_MODEL_DISPLAY_NAME?.trim()
      || `${deployment} (Azure OpenAI)`,
  });
}

// List the chat-capable deployments visible at the configured Azure OpenAI
// endpoint. Used by `/api/cast/models` to populate the model dropdown in
// the UI. Returns `null` when Azure auth isn't configured (caller falls
// back to a hardcoded list / hides the dropdown).
export interface AvailableModelInfo {
  // Deployment name to send to /api/cast (and to use as the URL segment
  // when calling /openai/deployments/{name}/chat/completions).
  deployment: string;
  // The model behind the deployment (e.g. "gpt-5", "gpt-4o-mini") — used
  // for the human-readable label in the UI.
  model: string;
  // Whether this deployment supports chat completions (the only thing
  // PodCraft uses today). We surface non-chat deployments for transparency
  // but the UI hides them.
  chatCapable: boolean;
}

export async function listAzureChatDeployments(opts?: {
  fetchImpl?: typeof fetch;
}): Promise<AvailableModelInfo[] | null> {
  if ((process.env.LLM_PROVIDER || '').toLowerCase() !== 'azure') return null;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  const clientId = (process.env.AZURE_OPENAI_CLIENT_ID || process.env.AZURE_CLIENT_ID)?.trim();
  const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();
  // The data-plane "list deployments" endpoint is only served by the
  // legacy 2023-03-15-preview API on most Azure OpenAI resources;
  // 2024-10-21 (the chat default) returns 404 for /openai/deployments.
  // Allow override for resources where this differs.
  const apiVersion = process.env.AZURE_OPENAI_LIST_API_VERSION?.trim() || '2023-03-15-preview';

  if (!endpoint || !tenantId || !clientId) return null;

  let credential: TokenCredential;
  if (clientSecret) {
    credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  } else {
    credential = new K8sFederatedAadCredential({
      tenantId,
      clientId,
      serviceAccountName: process.env.AZURE_SERVICE_ACCOUNT?.trim() || 'default',
    });
  }

  const fetchImpl = opts?.fetchImpl ?? fetch;
  let token;
  try {
    token = await credential.getToken(AZURE_COGNITIVE_SCOPE);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'listAzureChatDeployments: token acquisition failed',
    );
    return null;
  }
  if (!token) return null;

  const normalised = normaliseEndpoint(endpoint);
  const url = `${normalised}/openai/deployments?api-version=${encodeURIComponent(apiVersion)}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.token}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), url },
      'listAzureChatDeployments: network error',
    );
    return null;
  }
  const text = await response.text();
  if (!response.ok) {
    logger.warn(
      { status: response.status, body: text.slice(0, 400), url },
      'listAzureChatDeployments: non-2xx from Azure OpenAI',
    );
    return null;
  }

  let parsed: { data?: Array<{ id?: string; model?: string; capabilities?: { chat_completion?: boolean } }> };
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'listAzureChatDeployments: response was not JSON',
    );
    return null;
  }

  const items = parsed.data ?? [];
  const result: AvailableModelInfo[] = [];
  for (const item of items) {
    if (!item || typeof item.id !== 'string') continue;
    const deployment = item.id;
    const model = typeof item.model === 'string' ? item.model : deployment;
    // Trust an explicit chat_completion capability flag if Azure surfaces
    // one. When it doesn't (the 2023-03-15-preview list payload usually
    // omits capabilities), fall back to a model-family allow-list and
    // explicitly exclude non-chat speech / embedding / transcription
    // deployments — those would otherwise sneak through the gpt- prefix
    // (e.g. `gpt-4o-mini-tts`).
    const capChat = item.capabilities?.chat_completion;
    const looksLikeChatFamily = /^(gpt-|o1|o3|o4|chatgpt)/i.test(model);
    // Non-chat siblings of the gpt-* family (image generation, audio TTS /
    // STT, embeddings, moderation, completion-only legacy models). These all
    // share the gpt-* prefix on the listing endpoint so we must exclude them
    // explicitly — otherwise the dropdown surfaces models that 404 the
    // moment a user picks them.
    const isNonChatVariant =
      /(-tts|-transcribe|-stt|-realtime|-audio|whisper|embedding|embed|moderation|dall-?e|davinci|babbage|curie|ada|^gpt-image|-image|sora|video)/i.test(
        model,
      );
    const chatCapable =
      capChat === true ||
      (capChat === undefined && looksLikeChatFamily && !isNonChatVariant);
    result.push({ deployment, model, chatCapable });
  }
  return result;
}
