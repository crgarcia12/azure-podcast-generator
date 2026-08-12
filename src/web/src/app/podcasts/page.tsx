'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, toApiUrl } from '../lib/api';

const AUDIENCE_LEVELS = ['Beginner', 'Intermediate', 'Expert'] as const;
const EPISODE_DURATIONS = [5, 10, 15] as const;
const CONVERSATION_STYLES = ['Conversational', 'Educational', 'Debate'] as const;
type AudienceLevel = (typeof AUDIENCE_LEVELS)[number];
type EpisodeDurationMinutes = (typeof EPISODE_DURATIONS)[number];
type ConversationStyle = (typeof CONVERSATION_STYLES)[number];
type PodcastProvider = 'azure' | 'mock';

interface PodcastProviderCapabilities {
  defaultProvider: PodcastProvider;
  providers: {
    mock: { available: true; label: string };
    azure: { available: boolean; label: string; model: string | null };
  };
}

interface PodcastEpisodeContract {
  id: string;
  title: string;
  summary: string;
  controls: {
    audience: AudienceLevel;
    durationMinutes: EpisodeDurationMinutes;
    style: ConversationStyle;
  };
  generationStatus: 'preparing_audio' | 'ready' | 'failed';
  provider: PodcastProvider;
  transcript: Array<{
    id: string;
    speakerLabel: 'Host' | 'Guest';
    text: string;
  }>;
  audioSegments: Array<{
    id: string;
    status: 'ready' | 'pending' | 'failed';
    audioUrl: string | null;
  }>;
}

type InterventionState = 'idle' | 'received' | 'answering' | 'playing' | 'failed';

interface InterventionSegment {
  audioUrl: string;
  playbackPositionSeconds: number;
}

export default function PodcastsPage() {
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState<AudienceLevel>('Intermediate');
  const [durationMinutes, setDurationMinutes] = useState<EpisodeDurationMinutes>(5);
  const [style, setStyle] = useState<ConversationStyle>('Conversational');
  const [provider, setProvider] = useState<PodcastProvider>('mock');
  const [providerCapabilities, setProviderCapabilities] = useState<PodcastProviderCapabilities | null>(null);
  const [episode, setEpisode] = useState<PodcastEpisodeContract | null>(null);
  const [generationStatus, setGenerationStatus] = useState('');
  const [question, setQuestion] = useState('');
  const [lastQuestion, setLastQuestion] = useState('');
  const [interventionState, setInterventionState] = useState<InterventionState>('idle');
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const [segmentIndex, setSegmentIndex] = useState(0);
  const episodeAudioRef = useRef<HTMLAudioElement>(null);
  const interventionAudioRef = useRef<HTMLAudioElement>(null);
  const interruptionPositionRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const providerSelectedRef = useRef(false);

  const readySegments = episode?.audioSegments.filter((segment) => segment.status === 'ready') ?? [];
  const activeSegment = readySegments[segmentIndex];

  useEffect(() => {
    void apiFetch('/api/podcasts/providers')
      .then(async (response) => {
        if (!response.ok) return;
        const capabilities = await response.json() as PodcastProviderCapabilities;
        setProviderCapabilities(capabilities);
        if (!providerSelectedRef.current) setProvider(capabilities.defaultProvider);
      });
  }, []);

  useEffect(() => {
    if (!episode || episode.generationStatus === 'ready') return;
    const timer = window.setInterval(async () => {
      const response = await apiFetch('/api/podcasts');
      if (!response.ok) return;
      const payload = (await response.json()) as { episodes: PodcastEpisodeContract[] };
      const refreshed = payload.episodes.find((item) => item.id === episode.id);
      if (refreshed) setEpisode(refreshed);
    }, 500);
    return () => window.clearInterval(timer);
  }, [episode]);

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (!topic.trim()) return;
    setError('');
    setEpisode(null);
    setGenerationStatus('Generating script');
    try {
      const response = await apiFetch('/api/podcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), audience, durationMinutes, style, provider }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to generate this episode');
      setGenerationStatus('Preparing audio');
      setEpisode(payload.episode as PodcastEpisodeContract);
      setSegmentIndex(0);
      setAnnouncement('First audio segment ready');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to generate this episode');
      setGenerationStatus('');
    }
  };

  const playEpisode = useCallback(async () => {
    const audio = episodeAudioRef.current;
    if (!audio) return;
    try {
      await audio.play();
      setAnnouncement('Episode playing');
    } catch {
      setError('Playback was blocked. Activate Play again.');
    }
  }, []);

  const resumeEpisode = useCallback(async () => {
    requestControllerRef.current?.abort();
    setInterventionState('idle');
    const audio = episodeAudioRef.current;
    if (audio) {
      audio.currentTime = Math.min(interruptionPositionRef.current, audio.duration || interruptionPositionRef.current);
    }
    setAnnouncement('Episode resumed');
    await playEpisode();
  }, [playEpisode]);

  const askQuestion = useCallback(async (questionText: string) => {
    if (!episode || !questionText.trim()) return;
    const audio = episodeAudioRef.current;
    interruptionPositionRef.current = audio?.currentTime ?? 0;
    audio?.pause();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLastQuestion(questionText.trim());
    setInterventionState('received');
    setAnnouncement('Question received');
    setError('');
    window.setTimeout(() => {
      setInterventionState((current) => current === 'received' ? 'answering' : current);
      setAnnouncement('Answering question');
    }, 0);
    try {
      const response = await apiFetch(`/api/podcasts/${episode.id}/questions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: questionText.trim(),
          playbackPositionSeconds: interruptionPositionRef.current,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "We couldn't answer that question");
      const segment = payload.segment as InterventionSegment;
      const interventionAudio = interventionAudioRef.current;
      if (!interventionAudio) throw new Error("We couldn't answer that question");
      interventionAudio.src = toApiUrl(segment.audioUrl);
      setInterventionState('playing');
      setAnnouncement('Answer playing');
      await interventionAudio.play();
      setQuestion('');
    } catch (caught) {
      if (controller.signal.aborted) return;
      setInterventionState('failed');
      setAnnouncement('Question failed');
      setError(caught instanceof Error ? caught.message : "We couldn't answer that question");
    }
  }, [episode]);

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault();
    void askQuestion(question);
  };

  const cancelQuestion = () => {
    requestControllerRef.current?.abort();
    interventionAudioRef.current?.pause();
    setInterventionState('idle');
    setAnnouncement('Question cancelled');
  };

  const onEpisodeSegmentEnded = () => {
    if (segmentIndex + 1 < readySegments.length) setSegmentIndex((index) => index + 1);
  };

  useEffect(() => {
    if (segmentIndex > 0 && activeSegment) void playEpisode();
  }, [activeSegment, playEpisode, segmentIndex]);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">PodCraft Studio</p>
          <h1 className="mt-3 text-4xl font-bold sm:text-6xl">A podcast that meets you where you are.</h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-300">
            Choose the depth and tone. Playback starts as soon as the opening segment is ready.
          </p>
        </header>

        <form onSubmit={generate} className="rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
          <fieldset className="mb-6">
            <legend className="text-sm font-semibold">Podcast source</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <ProviderChoice
                checked={provider === 'azure'}
                label="Real podcast"
                description={providerCapabilities?.providers.azure.available
                  ? `Generated with Azure AI Foundry${providerCapabilities.providers.azure.model ? ` (${providerCapabilities.providers.azure.model})` : ''} and Azure Speech.`
                  : 'Select to use Azure AI Foundry. Generation will explain any missing server configuration.'}
                onChange={() => {
                  providerSelectedRef.current = true;
                  setProvider('azure');
                }}
              />
              <ProviderChoice
                checked={provider === 'mock'}
                label="Mock audio"
                description="Deterministic test content and synthetic tones. Not a real AI-generated podcast."
                onChange={() => {
                  providerSelectedRef.current = true;
                  setProvider('mock');
                }}
              />
            </div>
          </fieldset>
          <label className="block text-sm font-semibold" htmlFor="topic">What should we explore?</label>
          <input id="topic" value={topic} onChange={(event) => setTopic(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 focus:border-cyan-300 focus:outline-none"
            placeholder="History of Boeing" maxLength={120} required />
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Control label="Audience level" value={audience} values={AUDIENCE_LEVELS} onChange={setAudience} />
            <Control label="Episode length" value={durationMinutes} values={EPISODE_DURATIONS}
              format={(value) => `${value} minutes`} onChange={setDurationMinutes} />
            <Control label="Conversation style" value={style} values={CONVERSATION_STYLES} onChange={setStyle} />
          </div>
          <button className="mt-6 rounded-xl bg-cyan-300 px-6 py-3 font-bold text-slate-950 hover:bg-cyan-200 focus:outline-none focus:ring-4 focus:ring-cyan-500"
            type="submit">Generate episode</button>
          <p className="mt-3 text-sm text-slate-300" role="status">
            Current source: {provider === 'azure' ? 'Real podcast from Azure AI Foundry' : 'Mock testing audio'}
          </p>
        </form>

        {generationStatus && (
          <div className="mt-6 rounded-xl border border-cyan-700 bg-cyan-950/40 p-4" role="status">
            <strong>{episode?.generationStatus === 'ready' ? 'Ready' : generationStatus}</strong>
            {episode?.generationStatus === 'preparing_audio' && <span> — more audio is being prepared in the background.</span>}
          </div>
        )}

        {episode && (
          <section className="mt-8 rounded-3xl bg-white p-6 text-slate-900">
            <p className={`mb-3 inline-flex rounded-full px-3 py-1 text-sm font-bold ${
              episode.provider === 'azure' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
            }`}>
              {episode.provider === 'azure' ? 'Real podcast · Azure AI Foundry' : 'Mock podcast · Testing audio'}
            </p>
            <p className="text-sm font-semibold text-cyan-700">{episode.controls.audience} · {episode.controls.durationMinutes} min · {episode.controls.style}</p>
            <h2 className="mt-2 text-3xl font-bold">{episode.title}</h2>
            <p className="mt-2 text-slate-600">{episode.summary}</p>
            <audio ref={episodeAudioRef} src={activeSegment?.audioUrl ? toApiUrl(activeSegment.audioUrl) : undefined}
              onEnded={onEpisodeSegmentEnded} preload="metadata" />
            <audio ref={interventionAudioRef} onEnded={() => void resumeEpisode()} preload="none" />
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" disabled={!activeSegment || interventionState !== 'idle'} onClick={() => void playEpisode()}
                className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                Play episode
              </button>
              <button type="button" onClick={() => document.getElementById('question')?.focus()}
                className="rounded-xl border border-slate-400 px-5 py-3 font-bold">Ask a question</button>
              {interventionState !== 'idle' && (
                <button type="button" onClick={cancelQuestion} className="rounded-xl border border-rose-400 px-5 py-3 font-bold text-rose-700">Cancel</button>
              )}
              {interventionState !== 'idle' && (
                <button type="button" onClick={() => void resumeEpisode()} className="rounded-xl border border-slate-400 px-5 py-3 font-bold">Resume episode</button>
              )}
            </div>
            <form onSubmit={submitQuestion} className="mt-6">
              <label htmlFor="question" className="font-semibold">Question for the hosts</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input id="question" value={question} onChange={(event) => setQuestion(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-slate-400 px-4 py-3" maxLength={500}
                  placeholder="Why did jet engines matter?" />
                <button type="submit" className="rounded-xl bg-cyan-700 px-5 py-3 font-bold text-white">Send question</button>
              </div>
            </form>
            {interventionState === 'failed' && (
              <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-4" role="alert">
                <p>We couldn&apos;t answer that question. {error}</p>
                <div className="mt-3 flex gap-3">
                  <button type="button" onClick={() => void askQuestion(lastQuestion)} className="font-bold underline">Retry question</button>
                  <button type="button" onClick={() => void resumeEpisode()} className="font-bold underline">Resume episode</button>
                </div>
              </div>
            )}
            <div className="mt-8 space-y-3" aria-label="Episode transcript">
              {episode.transcript.map((turn) => (
                <p key={turn.id} className="rounded-xl bg-slate-100 p-4">
                  <strong>{turn.speakerLabel}:</strong> {turn.text}
                </p>
              ))}
            </div>
          </section>
        )}
        {error && interventionState !== 'failed' && <p className="mt-4 text-rose-300" role="alert">{error}</p>}
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      </div>
    </main>
  );
}

function ProviderChoice({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: () => void;
}) {
  return (
    <button type="button" aria-pressed={checked} onClick={onChange} className={`rounded-xl border p-4 text-left ${
      checked ? 'border-cyan-300 bg-cyan-950/60' : 'border-slate-600'
    } cursor-pointer`}>
      <span className="flex items-center gap-2 font-bold">
        <span aria-hidden="true" className={`h-3 w-3 rounded-full border ${
          checked ? 'border-cyan-300 bg-cyan-300' : 'border-slate-400'
        }`} />
        {label}
      </span>
      <span className="mt-1 block text-sm font-normal text-slate-300">{description}</span>
    </button>
  );
}

function Control<T extends string | number>({
  label, value, values, format = String, onChange,
}: {
  label: string;
  value: T;
  values: readonly T[];
  format?: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <select aria-label={label} value={value}
        onChange={(event) => {
          const selected = values.find((item) => String(item) === event.target.value);
          if (selected !== undefined) onChange(selected);
        }}
        className="mt-2 block w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3">
        {values.map((item) => <option key={item} value={item}>{format(item)}</option>)}
      </select>
    </label>
  );
}
