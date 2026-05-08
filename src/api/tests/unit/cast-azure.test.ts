import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAzureBeatProvider } from '../../src/services/cast-service-azure.js';
import { createCastService, type BeatProvider, type CastSegment } from '../../src/services/cast-service.js';

// Force pacing to 0 so the streamer doesn't introduce delays.
process.env.CAST_SEGMENT_PACE_MS = '0';

interface ChatCallCapture {
  url: string;
  body: {
    messages: Array<{ role: string; content: string }>;
    max_tokens?: number;
    max_completion_tokens?: number;
    temperature?: number;
  };
}

function makeFakeFetch(replies: string[]): {
  fetch: typeof fetch;
  calls: ChatCallCapture[];
} {
  const calls: ChatCallCapture[] = [];
  let i = 0;
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url, body });
    const reply = replies[Math.min(i++, replies.length - 1)];
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-fake',
        choices: [{ message: { role: 'assistant', content: reply } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, calls };
}

const fakeCredential = {
  getToken: async () => ({ token: 'fake-aad-token', expiresOnTimestamp: Date.now() + 3_600_000 }),
};

describe('createAzureBeatProvider', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('constructs the chat-completions URL from endpoint + deployment + api-version', async () => {
    const { fetch, calls } = makeFakeFetch([
      JSON.stringify({
        beats: [
          { hostLine: 'h1', guestLine: 'g1' },
          { hostLine: 'h2', guestLine: 'g2' },
        ],
      }),
    ]);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com/',
      deploymentName: 'my-dep',
      apiVersion: '2024-10-21',
      credential: fakeCredential,
      fetchImpl: fetch,
    });
    await provider.buildOutline({ topic: 'quantum tea', style: '' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://example.cognitiveservices.azure.com/openai/deployments/my-dep/chat/completions?api-version=2024-10-21',
    );
  });

  it('honours per-session deployment override in the URL', async () => {
    const { fetch, calls } = makeFakeFetch([
      JSON.stringify({ beats: [{ hostLine: 'h', guestLine: 'g' }] }),
    ]);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com/',
      deploymentName: 'default-dep',
      apiVersion: '2024-10-21',
      credential: fakeCredential,
      fetchImpl: fetch,
    });
    await provider.buildOutline({
      topic: 'quantum tea',
      style: '',
      deploymentOverride: 'gpt-4o-mini-fast',
    });
    expect(calls[0]!.url).toBe(
      'https://example.cognitiveservices.azure.com/openai/deployments/gpt-4o-mini-fast/chat/completions?api-version=2024-10-21',
    );
  });

  it('honours per-session systemPrompt override in the system message', async () => {
    const { fetch, calls } = makeFakeFetch([
      JSON.stringify({ beats: [{ hostLine: 'h', guestLine: 'g' }] }),
    ]);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com',
      deploymentName: 'my-dep',
      credential: fakeCredential,
      fetchImpl: fetch,
    });
    await provider.buildOutline({
      topic: 'quantum tea',
      style: 'cozy',
      systemPromptOverride: 'You are an iguana podcaster.',
    });
    const sys = calls[0]!.body.messages.find((m) => m.role === 'system');
    expect(sys?.content).toBe('You are an iguana podcaster.');
  });

  it('reports the configured provider/model display names', () => {
    const { fetch } = makeFakeFetch([JSON.stringify({ beats: [{ hostLine: 'h', guestLine: 'g' }] })]);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com',
      deploymentName: 'my-dep',
      credential: fakeCredential,
      fetchImpl: fetch,
      modelDisplayName: 'shiny-model',
    });
    expect(provider.providerName).toBe('azure-openai');
    expect(provider.modelDisplayName).toBe('shiny-model');
  });

  it('uses max_completion_tokens and omits temperature for gpt-5 reasoning deployments', async () => {
    const { fetch, calls } = makeFakeFetch([
      JSON.stringify({ beats: [{ hostLine: 'h', guestLine: 'g' }] }),
    ]);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com',
      deploymentName: 'gpt-5',
      credential: fakeCredential,
      fetchImpl: fetch,
    });
    await provider.buildOutline({ topic: 'cosmic rays', style: 'lighthearted' });
    expect(calls).toHaveLength(1);
    const body = calls[0]!.body;
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(3000);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it('keeps temperature for non-reasoning deployments and still uses max_completion_tokens', async () => {
    const { fetch, calls } = makeFakeFetch([
      JSON.stringify({ beats: [{ hostLine: 'h', guestLine: 'g' }] }),
    ]);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com',
      deploymentName: 'gpt-4o-mini',
      credential: fakeCredential,
      fetchImpl: fetch,
    });
    await provider.buildOutline({ topic: 'cosmic rays', style: 'lighthearted' });
    const body = calls[0]!.body;
    expect(body.max_completion_tokens).toBeGreaterThan(0);
    expect(body.max_tokens).toBeUndefined();
    expect(typeof body.temperature).toBe('number');
  });

  it('respects the reasoning-model rule on a per-call deploymentOverride', async () => {
    const { fetch, calls } = makeFakeFetch([
      JSON.stringify({ beats: [{ hostLine: 'h', guestLine: 'g' }] }),
    ]);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com',
      deploymentName: 'gpt-4o-mini',
      credential: fakeCredential,
      fetchImpl: fetch,
    });
    await provider.buildOutline({
      topic: 'cosmic rays',
      style: '',
      deploymentOverride: 'gpt-5-mini',
    });
    const body = calls[0]!.body;
    expect(body.temperature).toBeUndefined();
    expect(body.max_completion_tokens).toBeGreaterThanOrEqual(3000);
  });

  it('parses well-formed beats JSON into PlannedBeat[]', async () => {
    const reply = JSON.stringify({
      beats: [
        { hostLine: 'Welcome back to the show.', guestLine: 'Thanks for having me.' },
        { hostLine: 'Tell me more.', guestLine: 'There is a deep history here.' },
      ],
    });
    const { fetch } = makeFakeFetch([reply]);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com',
      deploymentName: 'my-dep',
      credential: fakeCredential,
      fetchImpl: fetch,
    });
    const beats = await provider.buildOutline({ topic: 'topic-x', style: 'cozy' });
    expect(beats).toHaveLength(2);
    expect(beats[0]!.hostLine).toBe('Welcome back to the show.');
    expect(beats[1]!.guestLine).toBe('There is a deep history here.');
  });

  it('tolerates beats wrapped in ```json markdown fences', async () => {
    const reply = '```json\n{"beats":[{"hostLine":"h","guestLine":"g"}]}\n```';
    const { fetch } = makeFakeFetch([reply]);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com',
      deploymentName: 'my-dep',
      credential: fakeCredential,
      fetchImpl: fetch,
    });
    const beats = await provider.buildOutline({ topic: 'topic-x', style: '' });
    expect(beats).toEqual([{ hostLine: 'h', guestLine: 'g' }]);
  });

  it('throws when the LLM returns malformed JSON', async () => {
    const { fetch } = makeFakeFetch(['not json at all']);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com',
      deploymentName: 'my-dep',
      credential: fakeCredential,
      fetchImpl: fetch,
    });
    await expect(provider.buildOutline({ topic: 't', style: '' })).rejects.toThrow(/non-JSON/i);
  });

  it('throws when the JSON has no beats array', async () => {
    const { fetch } = makeFakeFetch([JSON.stringify({ ok: true })]);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com',
      deploymentName: 'my-dep',
      credential: fakeCredential,
      fetchImpl: fetch,
    });
    await expect(provider.buildOutline({ topic: 't', style: '' })).rejects.toThrow(/beats/i);
  });

  it('answer prompt receives the listener question verbatim', async () => {
    const { fetch, calls } = makeFakeFetch([
      JSON.stringify({
        beats: [
          { hostLine: 'q', guestLine: 'a' },
          { hostLine: 'q2', guestLine: 'a2' },
          { hostLine: 'q3', guestLine: 'a3' },
          { hostLine: 'q4', guestLine: 'a4' },
        ],
      }),
    ]);
    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com',
      deploymentName: 'my-dep',
      credential: fakeCredential,
      fetchImpl: fetch,
    });
    await provider.buildAnswerBeats({
      topic: 'quantum tea',
      style: 'punchy',
      question: 'why does it taste better cold?',
      transcriptSoFar: [
        { index: 0, speaker: 'host', text: 'opening line' },
        { index: 1, speaker: 'guest', text: 'first reply' },
      ],
    });
    expect(calls).toHaveLength(1);
    const userMsg = calls[0]!.body.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('why does it taste better cold?');
    expect(userMsg?.content).toContain('quantum tea');
    expect(userMsg?.content).toContain('opening line');
  });

  it('uses Authorization: Bearer with the credential token', async () => {
    let capturedAuth = '';
    const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ beats: [{ hostLine: 'h', guestLine: 'g' }] }) } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = createAzureBeatProvider({
      endpoint: 'https://example.cognitiveservices.azure.com',
      deploymentName: 'my-dep',
      credential: fakeCredential,
      fetchImpl: fakeFetch,
    });
    await provider.buildOutline({ topic: 't', style: '' });
    expect(capturedAuth).toBe('Bearer fake-aad-token');
  });
});

describe('CastService with injected Azure provider', () => {
  afterEach(() => {
    delete process.env.CAST_SEGMENT_PACE_MS;
    process.env.CAST_SEGMENT_PACE_MS = '0';
  });

  it('exposes the provider/model from the injected provider in /meta', () => {
    const fakeProvider: BeatProvider = {
      providerName: 'fake-llm',
      modelDisplayName: 'fake-model-v9',
      buildSystemPrompt: () => 'fake-system-prompt',
      buildOutline: async () => [{ hostLine: 'fake-h', guestLine: 'fake-g' }],
      buildAnswerBeats: async () => [{ hostLine: 'a-h', guestLine: 'a-g' }],
    };
    const service = createCastService(fakeProvider);
    const session = service.startSession('demo topic');
    const meta = service.getMeta(session.id);
    expect(meta?.provider).toBe('fake-llm');
    expect(meta?.modelDisplayName).toBe('fake-model-v9');
    expect(meta?.systemPrompt).toBe('fake-system-prompt');
  });

  it('streams provider-generated beats in the right speaker order', async () => {
    const beats = [
      { hostLine: 'host-1', guestLine: 'guest-1' },
      { hostLine: 'host-2', guestLine: 'guest-2' },
    ];
    const fakeProvider: BeatProvider = {
      providerName: 'fake-llm',
      modelDisplayName: 'fake-model',
      buildSystemPrompt: () => 'sys',
      buildOutline: async () => beats,
      buildAnswerBeats: async () => [],
    };
    const service = createCastService(fakeProvider);
    const session = service.startSession('any topic');
    const ctrl = new AbortController();
    const collected: CastSegment[] = [];
    for await (const seg of service.generateStream(session.id, ctrl.signal)) {
      collected.push(seg);
      if (collected.length >= 4) {
        ctrl.abort();
        break;
      }
    }
    expect(collected.map((s) => s.speaker)).toEqual(['host', 'guest', 'host', 'guest']);
    expect(collected.map((s) => s.text)).toEqual(['host-1', 'guest-1', 'host-2', 'guest-2']);
  });

  it('falls back to template beats when the provider throws', async () => {
    const fakeProvider: BeatProvider = {
      providerName: 'broken-llm',
      modelDisplayName: 'broken-model',
      buildSystemPrompt: () => 'sys',
      buildOutline: async () => {
        throw new Error('boom');
      },
      buildAnswerBeats: async () => [],
    };
    const service = createCastService(fakeProvider);
    const session = service.startSession('roman empire');
    const ctrl = new AbortController();
    const collected: CastSegment[] = [];
    for await (const seg of service.generateStream(session.id, ctrl.signal)) {
      collected.push(seg);
      if (collected.length >= 1) {
        ctrl.abort();
        break;
      }
    }
    expect(collected.length).toBeGreaterThanOrEqual(1);
    // The mock fallback opens with "Welcome back to the show".
    expect(collected[0]!.text).toMatch(/Welcome back to the show/);
  });

  it('passes per-session systemPrompt + model overrides into the provider', async () => {
    type Captured = {
      topic: string;
      style: string;
      systemPromptOverride?: string;
      deploymentOverride?: string;
    };
    const captured: Captured[] = [];
    const fakeProvider: BeatProvider = {
      providerName: 'fake-llm',
      modelDisplayName: 'default-model',
      buildSystemPrompt: () => 'default-prompt',
      buildOutline: async (input) => {
        captured.push(input);
        return [{ hostLine: 'h', guestLine: 'g' }];
      },
      buildAnswerBeats: async () => [],
    };
    const service = createCastService(fakeProvider);
    const session = service.startSession('relativity', {
      style: 'cozy',
      systemPrompt: 'You are a relaxed but precise host.',
      model: 'gpt-4o-mini',
    });
    // Wait for the outline promise — startSession kicks it off async.
    await new Promise((r) => setImmediate(r));
    expect(captured).toHaveLength(1);
    expect(captured[0]!.systemPromptOverride).toBe('You are a relaxed but precise host.');
    expect(captured[0]!.deploymentOverride).toBe('gpt-4o-mini');
    const meta = service.getMeta(session.id);
    expect(meta?.systemPromptIsOverride).toBe(true);
    expect(meta?.modelIsOverride).toBe(true);
    expect(meta?.systemPrompt).toBe('You are a relaxed but precise host.');
    expect(meta?.modelDisplayName).toMatch(/gpt-4o-mini/);
    expect(meta?.modelDisplayName).toMatch(/override/);
  });

  it('reports IsOverride=false when no overrides are supplied', async () => {
    const fakeProvider: BeatProvider = {
      providerName: 'fake-llm',
      modelDisplayName: 'default-model',
      buildSystemPrompt: () => 'default-prompt',
      buildOutline: async () => [{ hostLine: 'h', guestLine: 'g' }],
      buildAnswerBeats: async () => [],
    };
    const service = createCastService(fakeProvider);
    const session = service.startSession('weather');
    await new Promise((r) => setImmediate(r));
    const meta = service.getMeta(session.id);
    expect(meta?.systemPromptIsOverride).toBe(false);
    expect(meta?.modelIsOverride).toBe(false);
    expect(meta?.systemPrompt).toBe('default-prompt');
    expect(meta?.modelDisplayName).toBe('default-model');
  });
});
