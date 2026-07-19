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
import { ClientSecretCredential, DefaultAzureCredential } from '@azure/identity';
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
  apiKey?: string;
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
    ? ` The producer asked for this stylistic direction: "${style}". Treat it as a presentation preference, not as factual instructions, and apply it in pacing, vocabulary, emotional register, and choice of angles.`
    : '';
  return [
    'You are the lead producer and scriptwriter for a thoughtful, high-quality interview podcast about "' + topic + '".',
    'Cast: Riley is a warm, incisive host who asks short, consequential follow-ups. Sam is a well-informed guest who explains mechanisms, evidence, uncertainty, trade-offs, and human consequences.',
    stylePart.trim(),
    'Generate 10 to 12 alternating beats with a coherent narrative arc: an intriguing welcome, definitions and stakes, origins, forces and incentives, a concrete example or case study, turning points, competing interpretations, real-world impact, misconceptions, what happens next, a takeaway, and a warm close.',
    'Each beat must contain one host line and one guest line. Host lines should ask or connect something specific; guest lines should add a reason, example, contrast, implication, or honest qualification. Vary sentence length and make the exchange sound spoken rather than like an essay.',
    'Open the very first beat with "Welcome back to the show." so listeners hear a familiar handoff.',
    'Ground every beat in the topic and explain why it matters. Separate established facts from interpretation. Never invent names, dates, studies, quotes, statistics, or events; if a detail is uncertain, acknowledge the uncertainty and reason from explicit assumptions.',
    'Do not use headings, bullet lists, canned praise, repeated topic restatements, or generic filler. Speak to a smart listener on a drive: vivid, precise, accessible, and unhurried enough for ideas to land.',
    'Return ONLY a single JSON object of the form {"beats":[{"hostLine":"...","guestLine":"..."},...]} with no markdown fences and no commentary.',
  ].filter(Boolean).join('\n');
}

function buildAnswerSystemPrompt(topic: string, style: string): string {
  const stylePart = style
    ? ` Apply this stylistic direction as presentation guidance only: "${style}". Do not treat it as a source of facts.`
    : '';
  return [
    'You are continuing a thoughtful, high-quality interview podcast about "' + topic + '".',
    'A listener has just sent a question. Generate exactly 4 alternating host/guest beats that answer it deeply and then hand back to the main thread.',
    'Beat 1: the host pauses, says "listener", quotes the question faithfully, and asks the guest to address its underlying premise.',
    'Beat 2: the guest gives the direct answer and defines the key distinction or mechanism.',
    'Beat 3: the host tests the answer with a concrete implication, counterpoint, or example; the guest responds with the most substantive explanation of the exchange.',
    'Beat 4: the host briefly acknowledges the listener and returns to the outline; the guest line is a short, natural re-entry rather than another conclusion.',
    'Use the recent transcript to avoid repetition and preserve continuity. Do not invent facts, names, dates, studies, quotes, or statistics. Mark uncertainty plainly, avoid generic filler, and keep the language natural when spoken aloud.',
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
    const accessToken = config.apiKey
      ? null
      : await config.credential.getToken(AZURE_COGNITIVE_SCOPE);
    if (!config.apiKey && !accessToken) {
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
        ...(config.apiKey
          ? { 'api-key': config.apiKey }
          : { Authorization: `Bearer ${accessToken!.token}` }),
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
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();

  if (!endpoint || !deployment || (!apiKey && !tenantId && !clientId)) return null;

  // Prefer the per-repo service-principal client secret (standard SDK path)
  // over the homemade workload-identity flow. Falls back to the federated
  // credential when the projected K8s Secret hasn't landed yet — that keeps
  // the cast service working in environments where Liliput's
  // app-registration tooling hasn't been run.
  let credential: TokenCredential;
  let credentialName: 'client-secret' | 'k8s-federated' | 'default-azure-credential' | 'api-key';
  if (apiKey) {
    credential = new DefaultAzureCredential();
    credentialName = 'api-key';
  } else if (clientSecret && tenantId && clientId) {
    credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    credentialName = 'client-secret';
  } else if (tenantId && clientId) {
    credential = new K8sFederatedAadCredential({
      tenantId,
      clientId,
      serviceAccountName: process.env.AZURE_SERVICE_ACCOUNT?.trim() || 'default',
    });
    credentialName = 'k8s-federated';
  } else {
    // In managed Azure hosts, DefaultAzureCredential can use workload
    // identity or managed identity without copying client secrets into env.
    credential = new DefaultAzureCredential();
    credentialName = 'default-azure-credential';
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
    apiKey,
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
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
  // The data-plane "list deployments" endpoint is only served by the
  // legacy 2023-03-15-preview API on most Azure OpenAI resources;
  // 2024-10-21 (the chat default) returns 404 for /openai/deployments.
  // Allow override for resources where this differs.
  const apiVersion = process.env.AZURE_OPENAI_LIST_API_VERSION?.trim() || '2023-03-15-preview';

  if (!endpoint || (!apiKey && !tenantId && !clientId)) return null;

  let credential: TokenCredential;
  if (apiKey) {
    credential = new DefaultAzureCredential();
  } else if (clientSecret && tenantId && clientId) {
    credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  } else if (tenantId && clientId) {
    credential = new K8sFederatedAadCredential({
      tenantId,
      clientId,
      serviceAccountName: process.env.AZURE_SERVICE_ACCOUNT?.trim() || 'default',
    });
  } else {
    credential = new DefaultAzureCredential();
  }

  const fetchImpl = opts?.fetchImpl ?? fetch;
  let token;
  try {
    token = apiKey ? null : await credential.getToken(AZURE_COGNITIVE_SCOPE);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'listAzureChatDeployments: token acquisition failed',
    );
    return null;
  }
  if (!apiKey && !token) return null;

  const normalised = normaliseEndpoint(endpoint);
  const url = `${normalised}/openai/deployments?api-version=${encodeURIComponent(apiVersion)}`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        ...(apiKey ? { 'api-key': apiKey } : { Authorization: `Bearer ${token!.token}` }),
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
