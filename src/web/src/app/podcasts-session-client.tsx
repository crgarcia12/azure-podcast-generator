'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, toApiUrl } from './lib/api';
import type {
  PodcastAudienceLevel,
  PodcastAudioSegment,
  PodcastConversationStyle,
  PodcastDurationMinutes,
  PodcastGenerationControls,
  PodcastGenerationRequest,
  PodcastGenerationState,
  PodcastInterventionContract,
  PodcastSessionContract,
  PodcastTranscriptTurn,
} from '../../../shared/types/podcast';

type SessionEnvelope = PodcastSessionContract | { session: PodcastSessionContract };
type InterventionEnvelope = PodcastInterventionContract | { intervention: PodcastInterventionContract };

const POLL_INTERVAL_MS = 2000;

const audienceOptions: Array<{ label: string; value: PodcastAudienceLevel }> = [
  { label: 'Beginner', value: 'beginner' },
  { label: 'Intermediate', value: 'intermediate' },
  { label: 'Expert', value: 'expert' },
];

const durationOptions: Array<{ label: string; value: PodcastDurationMinutes }> = [
  { label: '5 minutes', value: 5 },
  { label: '10 minutes', value: 10 },
  { label: '15 minutes', value: 15 },
];

const styleOptions: Array<{ label: string; value: PodcastConversationStyle }> = [
  { label: 'Conversational', value: 'conversational' },
  { label: 'Educational', value: 'educational' },
  { label: 'Debate', value: 'debate' },
];

function parseSession(payload: SessionEnvelope): PodcastSessionContract {
  if ('session' in payload && payload.session) return payload.session;
  return payload as PodcastSessionContract;
}

function parseIntervention(payload: InterventionEnvelope): PodcastInterventionContract {
  if ('intervention' in payload && payload.intervention) return payload.intervention;
  return payload as PodcastInterventionContract;
}

function sortSegments(segments: PodcastAudioSegment[]): PodcastAudioSegment[] {
  return [...segments].sort((a, b) => a.index - b.index);
}

function generationLabel(generationState: PodcastGenerationState): string {
  if (generationState === 'generating-script') return 'Generating script';
  if (generationState === 'preparing-audio') return 'Preparing audio';
  if (generationState === 'ready') return 'Ready';
  return 'Failed';
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function PodcastsSessionClient() {
  const [topic, setTopic] = useState('');
  const [audienceLevel, setAudienceLevel] = useState<PodcastAudienceLevel>('intermediate');
  const [durationMinutes, setDurationMinutes] = useState<PodcastDurationMinutes>(10);
  const [conversationStyle, setConversationStyle] = useState<PodcastConversationStyle>('conversational');
  const [session, setSession] = useState<PodcastSessionContract | null>(null);
  const [stageText, setStageText] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [playerMessage, setPlayerMessage] = useState<string | null>(null);
  const [questionText, setQuestionText] = useState('');
  const [savedQuestionText, setSavedQuestionText] = useState('');
  const [announcement, setAnnouncement] = useState('Ready');
  const [intervention, setIntervention] = useState<PodcastInterventionContract | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [isSubmittingQuestion, setIsSubmittingQuestion] = useState(false);
  const [episodeSource, setEpisodeSource] = useState<string | null>(null);
  const [answerSource, setAnswerSource] = useState<string | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [lastCompletedSegmentId, setLastCompletedSegmentId] = useState<string | null>(null);
  const [needsManualPlay, setNeedsManualPlay] = useState(false);
  const [requiresAuthentication, setRequiresAuthentication] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const episodeAudioRef = useRef<HTMLAudioElement | null>(null);
  const answerAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionAbortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const capturedPositionRef = useRef(0);
  const currentInterventionRef = useRef<PodcastInterventionContract | null>(null);
  const sessionId = session?.id ?? null;

  useEffect(() => {
    currentInterventionRef.current = intervention;
  }, [intervention]);

  useEffect(() => {
    if (!sessionId) return;
    const pending = session?.generationState === 'generating-script' || session?.generationState === 'preparing-audio';
    if (!pending) return;

    const intervalId = window.setInterval(async () => {
      try {
        const res = await apiFetch(`/api/podcasts/sessions/${encodeURIComponent(sessionId)}`);
        if (!res.ok) return;
        const payload = (await res.json()) as SessionEnvelope;
        const parsed = parseSession(payload);
        setSession(parsed);
        setStageText(generationLabel(parsed.generationState));
      } catch {
        // ignore transient polling failures
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [sessionId, session?.generationState]);

  const orderedSegments = useMemo(
    () => sortSegments(session?.segments ?? []),
    [session?.segments],
  );
  const isInterventionBlocking =
    intervention?.state === 'received'
    || intervention?.state === 'answering'
    || intervention?.state === 'ready'
    || Boolean(answerSource);

  useEffect(() => {
    if (!session || isInterventionBlocking) return;
    const target = orderedSegments.find((segment) => segment.index === playbackIndex);
    if (!target) return;

    if (target.status === 'failed') {
      setAnnouncement(`Segment ${target.index + 1} failed. Skipping.`);
      setPlaybackIndex((prev) => prev + 1);
      return;
    }
    if (target.status === 'preparing' || !target.audioUrl) return;
    if (activeSegmentId === target.id) return;

    setActiveSegmentId(target.id);
    setEpisodeSource(toApiUrl(target.audioUrl));
  }, [activeSegmentId, isInterventionBlocking, orderedSegments, playbackIndex, session]);

  useEffect(() => {
    const audio = episodeAudioRef.current;
    if (!audio || !episodeSource || isInterventionBlocking) return;
    const startPlayback = async () => {
      setNeedsManualPlay(false);
      try {
        await audio.play();
      } catch {
        setNeedsManualPlay(true);
        setPlayerMessage('Playback was blocked. Use Resume episode to continue.');
      }
    };
    void startPlayback();
  }, [episodeSource, isInterventionBlocking]);

  const postResumedTelemetry = useCallback(async () => {
    if (!sessionId) return;
    const current = currentInterventionRef.current;
    try {
      await apiFetch(`/api/podcasts/sessions/${encodeURIComponent(sessionId)}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interventionId: current?.id,
          playbackPositionSeconds: capturedPositionRef.current,
        }),
      });
    } catch {
      // best effort telemetry
    }
  }, [sessionId]);

  const resumeEpisode = useCallback(async () => {
    const audio = episodeAudioRef.current;
    if (!audio) return;

    setIntervention((prev) => (prev ? { ...prev, state: 'resumed' } : prev));
    setAnnouncement('Episode resumed');
    setIsAsking(false);
    setPlayerMessage(null);
    setNeedsManualPlay(false);
    try {
      audio.currentTime = capturedPositionRef.current;
    } catch {
      // ignore seek failures
    }
    await postResumedTelemetry();
    try {
      await audio.play();
    } catch {
      setNeedsManualPlay(true);
      setPlayerMessage('Autoplay is blocked. Press Resume episode again.');
    }
  }, [postResumedTelemetry]);

  const beginQuestion = useCallback(() => {
    const audio = episodeAudioRef.current;
    const current = audio?.currentTime ?? 0;
    capturedPositionRef.current = current;
    audio?.pause();
    setIsAsking(true);
    setError(null);
    setPlayerMessage(null);
  }, []);

  const cancelQuestion = useCallback(() => {
    const requestId = activeRequestIdRef.current;
    const controller = questionAbortRef.current;
    if (controller) {
      controller.abort();
      questionAbortRef.current = null;
    }
    if (sessionId && requestId) {
      void apiFetch(
        `/api/podcasts/sessions/${encodeURIComponent(sessionId)}/interventions/${encodeURIComponent(requestId)}`,
        { method: 'DELETE' },
      ).then((response) => {
        if (!response.ok && response.status !== 404) {
          setPlayerMessage('The answer request could not be cancelled remotely. You can still resume the episode.');
        }
      }).catch(() => {
        setPlayerMessage('The answer request could not be cancelled remotely. You can still resume the episode.');
      });
    }
    setIsSubmittingQuestion(false);
    setIntervention((prev) => prev
      ? { ...prev, state: 'cancelled' }
      : {
          id: requestId ?? uuid(),
          state: 'cancelled',
          capturedPositionSeconds: capturedPositionRef.current,
        });
    setAnnouncement('Question cancelled');
    setIsAsking(false);
  }, [sessionId]);

  const submitInterrupt = useCallback(async (text: string, isRetry = false) => {
    if (!session) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    const currentSegment = orderedSegments.find((segment) => segment.id === activeSegmentId);
    const fallbackAfterSegment = currentSegment?.id
      || lastCompletedSegmentId
      || orderedSegments[0]?.id
      || '';

    setSavedQuestionText(trimmed);
    setError(null);
    setPlayerMessage(null);
    setIsSubmittingQuestion(true);
    setIntervention(null);
    setAnnouncement('Question received');
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    setAnnouncement('Answering question');

    const controller = new AbortController();
    const requestId = uuid();
    activeRequestIdRef.current = requestId;
    questionAbortRef.current = controller;

    try {
      const response = await apiFetch(`/api/podcasts/sessions/${encodeURIComponent(session.id)}/interventions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          questionText: trimmed,
          afterSegmentId: fallbackAfterSegment,
          clientRequestId: requestId,
          playbackPositionSeconds: capturedPositionRef.current,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `Interrupt failed with status ${response.status}`);
      }

      const payload = (await response.json()) as InterventionEnvelope;
      const parsed = parseIntervention(payload);
      setIntervention(parsed);
      setIsAsking(false);

      if (parsed.state === 'failed') {
        setAnnouncement('Question failed');
        setError(parsed.errorCode ? `Question failed: ${parsed.errorCode}` : 'Question failed.');
        return;
      }
      if (parsed.state === 'cancelled') {
        setAnnouncement('Question cancelled');
        return;
      }
      if (parsed.answerAudioUrl) {
        capturedPositionRef.current = parsed.capturedPositionSeconds;
        setAnswerSource(toApiUrl(parsed.answerAudioUrl));
      } else if (!isRetry) {
        await resumeEpisode();
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setAnnouncement('Question cancelled');
      } else {
        const message = err instanceof Error ? err.message : 'Unable to process question.';
        setError(message);
        setAnnouncement('Question failed');
      }
      setIntervention((prev) => (prev ? { ...prev, state: 'failed' } : { id: uuid(), state: 'failed', capturedPositionSeconds: capturedPositionRef.current }));
    } finally {
      setIsSubmittingQuestion(false);
      if (questionAbortRef.current === controller) {
        questionAbortRef.current = null;
      }
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = null;
      }
    }
  }, [activeSegmentId, lastCompletedSegmentId, orderedSegments, resumeEpisode, session]);

  useEffect(() => {
    const answerAudio = answerAudioRef.current;
    if (!answerAudio || !answerSource) return;

    const playAnswer = async () => {
      try {
        await answerAudio.play();
      } catch {
        setPlayerMessage('Answer playback was blocked. Use Resume episode to continue.');
      }
    };
    void playAnswer();
  }, [answerSource]);

  const createPodcastSession = async () => {
    const trimmedTopic = topic.trim();
    if (!trimmedTopic) {
      setError('Enter a topic.');
      return;
    }

    setError(null);
    setSession(null);
    setIntervention(null);
    setEpisodeSource(null);
    setAnswerSource(null);
    setActiveSegmentId(null);
    setPlaybackIndex(0);
    setLastCompletedSegmentId(null);
    setAnnouncement('Generating script');
    setStageText('Generating script');

    const payload: PodcastGenerationRequest = {
      topic: trimmedTopic,
      audienceLevel,
      durationMinutes,
      conversationStyle,
    };

    try {
      const response = await apiFetch('/api/podcasts/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        if (response.status === 401) {
          setRequiresAuthentication(true);
          setStageText('Sign in required');
          setAnnouncement('Your session expired. Sign in to continue generating this episode.');
          return;
        }
        throw new Error(data?.error || `Session creation failed with status ${response.status}`);
      }

      const data = (await response.json()) as SessionEnvelope;
      const parsed = parseSession(data);
      setRequiresAuthentication(false);
      setSession(parsed);
      setStageText(generationLabel(parsed.generationState));
      setAnnouncement(generationLabel(parsed.generationState));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create session.');
      setStageText('Failed');
    }
  };

  const handleCreateSession = (event: FormEvent) => {
    event.preventDefault();
    void createPodcastSession();
  };

  const authenticate = async (mode: 'login' | 'register') => {
    if (!username.trim() || !password) {
      setAuthError('Enter your username and password.');
      return;
    }

    setAuthError(null);
    setIsAuthenticating(true);
    try {
      const response = await apiFetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || `Authentication failed with status ${response.status}`);
      }

      setRequiresAuthentication(false);
      setAnnouncement('Signed in. Continuing episode generation.');
      await createPodcastSession();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to authenticate.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const transcript: PodcastTranscriptTurn[] = session?.transcript ?? [];
  const controls: PodcastGenerationControls | null = session?.controls ?? null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8">
      <h1 className="text-2xl font-semibold">Podcast sessions</h1>

      {requiresAuthentication ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-lg font-semibold">Sign in to generate</h2>
          <p className="mt-1 text-sm text-black/70">
            Your session expired. Sign in or create an account, and the episode request will continue automatically.
          </p>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void authenticate('login');
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="font-medium">Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="rounded border border-black/25 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="rounded border border-black/25 px-3 py-2"
              />
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button
                type="submit"
                disabled={isAuthenticating}
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              >
                Sign in
              </button>
              <button
                type="button"
                disabled={isAuthenticating}
                onClick={() => void authenticate('register')}
                className="rounded border border-black/25 px-4 py-2 disabled:opacity-50"
              >
                Create account
              </button>
            </div>
            {authError ? <p role="alert" className="text-sm text-red-700 sm:col-span-2">{authError}</p> : null}
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border border-black/10 p-4">
        <form onSubmit={handleCreateSession} className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2 md:col-span-2">
            <span className="font-medium">Topic</span>
            <input
              type="text"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              className="rounded border border-black/25 px-3 py-2"
              placeholder="e.g. Building resilient distributed systems"
              maxLength={200}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-medium">Audience level</span>
            <select
              value={audienceLevel}
              onChange={(event) => setAudienceLevel(event.target.value as PodcastAudienceLevel)}
              className="rounded border border-black/25 px-3 py-2"
            >
              {audienceOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-medium">Episode length</span>
            <select
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(Number(event.target.value) as PodcastDurationMinutes)}
              className="rounded border border-black/25 px-3 py-2"
            >
              {durationOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 md:col-span-2">
            <span className="font-medium">Conversation style</span>
            <select
              value={conversationStyle}
              onChange={(event) => setConversationStyle(event.target.value as PodcastConversationStyle)}
              className="rounded border border-black/25 px-3 py-2"
            >
              {styleOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              disabled={!topic.trim()}
            >
              Generate episode
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-black/10 p-4">
        <p className="text-sm text-black/70">
          Status: <strong>{stageText}</strong>
        </p>
        <div role="status" aria-live="polite" aria-atomic="true" className="mt-2 min-h-6 text-sm">
          {announcement}
        </div>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        {playerMessage ? <p className="mt-2 text-sm text-amber-700">{playerMessage}</p> : null}
      </section>

      {session ? (
        <section className="rounded-lg border border-black/10 p-4">
          <h2 className="text-xl font-semibold">{session.title}</h2>
          <p className="text-sm text-black/70">{session.summary}</p>
          <p className="mt-2 text-sm">
            Topic: <strong>{session.topic}</strong>
          </p>
          <p className="text-sm">
            Estimated duration: <strong>{session.estimatedDurationMinutes} minutes</strong>
          </p>
          {controls ? (
            <ul className="mt-2 list-disc pl-6 text-sm">
              <li>Audience: {controls.audienceLevel}</li>
              <li>Length: {controls.durationMinutes} minutes</li>
              <li>Style: {controls.conversationStyle}</li>
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-lg border border-black/10 p-4">
        <h2 className="text-lg font-semibold">Episode audio</h2>
        <audio
          ref={episodeAudioRef}
          src={episodeSource ?? undefined}
          controls
          onEnded={() => {
            if (!activeSegmentId) return;
            setLastCompletedSegmentId(activeSegmentId);
            setPlaybackIndex((prev) => prev + 1);
            setActiveSegmentId(null);
          }}
          onError={() => {
            setAnnouncement('Episode segment playback failed. Skipping segment.');
            setPlaybackIndex((prev) => prev + 1);
            setActiveSegmentId(null);
          }}
          className="mt-2 w-full"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={beginQuestion}
            disabled={!session || isSubmittingQuestion}
            className="rounded border border-black/25 px-3 py-2 disabled:opacity-50"
          >
            Ask a question
          </button>
          {isSubmittingQuestion ? (
            <button
              type="button"
              onClick={cancelQuestion}
              className="rounded border border-black/25 px-3 py-2"
            >
              Cancel
            </button>
          ) : null}
          {(intervention?.state === 'failed' || intervention?.state === 'cancelled') && savedQuestionText ? (
            <button
              type="button"
              onClick={() => void submitInterrupt(savedQuestionText, true)}
              className="rounded border border-black/25 px-3 py-2"
            >
              Retry
            </button>
          ) : null}
          {(needsManualPlay || intervention?.state === 'failed' || intervention?.state === 'cancelled' || intervention?.state === 'resumed') ? (
            <button
              type="button"
              onClick={() => void resumeEpisode()}
              className="rounded bg-black px-3 py-2 text-white"
            >
              Resume episode
            </button>
          ) : null}
        </div>
      </section>

      {isAsking ? (
        <section className="rounded-lg border border-black/10 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitInterrupt(questionText);
            }}
            className="flex flex-col gap-3"
          >
            <label className="flex flex-col gap-2">
              <span className="font-medium">Your question</span>
              <textarea
                value={questionText}
                onChange={(event) => setQuestionText(event.target.value)}
                className="min-h-24 rounded border border-black/25 px-3 py-2"
                placeholder="Ask a follow-up question"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={!questionText.trim() || isSubmittingQuestion}
                className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
              >
                Ask a question
              </button>
              <button
                type="button"
                onClick={cancelQuestion}
                className="rounded border border-black/25 px-3 py-2"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border border-black/10 p-4">
        <h2 className="text-lg font-semibold">Answer audio</h2>
        <audio
          ref={answerAudioRef}
          src={answerSource ?? undefined}
          controls
          onEnded={() => {
            setAnswerSource(null);
            void resumeEpisode();
          }}
          className="mt-2 w-full"
        />
        {intervention?.answerText ? (
          <p className="mt-2 text-sm text-black/80">{intervention.answerText}</p>
        ) : null}
      </section>

      <section className="rounded-lg border border-black/10 p-4">
        <h2 className="text-lg font-semibold">Transcript</h2>
        {transcript.length === 0 ? (
          <p className="text-sm text-black/60">Transcript will appear as the session is generated.</p>
        ) : (
          <ol className="space-y-2">
            {transcript.map((turn, index) => (
              <li key={`${turn.speaker}-${index}`} className="rounded border border-black/10 p-2 text-sm">
                <p className="font-semibold capitalize">{turn.speaker}</p>
                <p>{turn.text}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
