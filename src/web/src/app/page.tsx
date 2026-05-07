'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, toApiUrl } from './lib/api';

type Speaker = 'host' | 'guest';

interface CastSegment {
  index: number;
  speaker: Speaker;
  text: string;
}

type Phase = 'idle' | 'starting' | 'playing' | 'asking' | 'error';

const HOST_NAME = 'Riley';
const GUEST_NAME = 'Sam';

// Voice name hints in priority order. Lower-cased substrings — first match wins.
// Covers Apple (Safari/iOS), Microsoft Edge/Windows, Google Chrome, plus a
// generic gendered fallback so even unknown engines pick distinct voices.
const HOST_VOICE_HINTS = [
  // Microsoft Natural / Edge
  'aria',
  'jenny',
  'jessa',
  'libby',
  // Apple
  'samantha',
  'allison',
  'serena',
  'karen',
  'tessa',
  'victoria',
  'ava',
  'susan',
  'moira',
  'fiona',
  // Google
  'google us english female',
  'google uk english female',
  'google us english',
  // Generic gender hints (some engines report "Microsoft Zira - English (United States)" etc)
  'female',
  'woman',
  'zira',
];

const GUEST_VOICE_HINTS = [
  // Microsoft Natural / Edge
  'guy',
  'davis',
  'tony',
  'ryan',
  'andrew',
  'brian',
  // Apple
  'daniel',
  'fred',
  'alex',
  'tom',
  'oliver',
  'arthur',
  'lee',
  'bruce',
  'aaron',
  'rishi',
  // Google
  'google us english male',
  'google uk english male',
  // Generic gender hints
  'male',
  'man',
  'mark',
  'david',
];

function chooseVoice(
  voices: SpeechSynthesisVoice[],
  hints: string[],
  avoid: SpeechSynthesisVoice | null,
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const pool = en.length ? en : voices;

  for (const hint of hints) {
    const found = pool.find(
      (v) => v.name.toLowerCase().includes(hint) && (!avoid || v.voiceURI !== avoid.voiceURI),
    );
    if (found) return found;
  }

  // Fallback: any voice that isn't `avoid`.
  const distinct = pool.find((v) => !avoid || v.voiceURI !== avoid.voiceURI);
  return distinct ?? pool[0] ?? null;
}

interface VoicePair {
  host: SpeechSynthesisVoice | null;
  guest: SpeechSynthesisVoice | null;
}

function selectVoicePair(voices: SpeechSynthesisVoice[]): VoicePair {
  const host = chooseVoice(voices, HOST_VOICE_HINTS, null);
  const guest = chooseVoice(voices, GUEST_VOICE_HINTS, host);
  return { host, guest };
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [topic, setTopic] = useState('');
  const [topicInput, setTopicInput] = useState('');
  const [questionInput, setQuestionInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentSegment, setCurrentSegment] = useState<CastSegment | null>(null);
  const [streamFinished, setStreamFinished] = useState(false);

  const queueRef = useRef<CastSegment[]>([]);
  const speakingRef = useRef<boolean>(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const voicePairRef = useRef<VoicePair>({ host: null, guest: null });
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Highest segment index we've received so far. -1 means none yet.
  // Used as `?since=lastIndex+1` when reconnecting after asking a question
  // so the server doesn't replay segments we already heard.
  const lastSegmentIndexRef = useRef<number>(-1);
  const speechSupported = useMemo(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window,
    [],
  );

  // Keep latest voice list (Chrome populates asynchronously).
  useEffect(() => {
    if (!speechSupported) return;
    const sync = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
      // Re-pick voices any time the list changes — only updates if not yet chosen
      // OR if previous choices are no longer in the list.
      const have = voicesRef.current;
      const stillThere = (v: SpeechSynthesisVoice | null) =>
        !v || have.some((x) => x.voiceURI === v.voiceURI);
      if (
        !voicePairRef.current.host ||
        !voicePairRef.current.guest ||
        !stillThere(voicePairRef.current.host) ||
        !stillThere(voicePairRef.current.guest)
      ) {
        voicePairRef.current = selectVoicePair(have);
      }
    };
    sync();
    window.speechSynthesis.addEventListener?.('voiceschanged', sync);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', sync);
    };
  }, [speechSupported]);

  const speakNext = useCallback(() => {
    if (!speechSupported) return;
    if (speakingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setCurrentSegment(null);
      return;
    }
    speakingRef.current = true;
    setCurrentSegment(next);

    // Make sure we have a voice pair — voices may have just become available.
    if (!voicePairRef.current.host || !voicePairRef.current.guest) {
      const fresh = window.speechSynthesis.getVoices();
      if (fresh.length) {
        voicesRef.current = fresh;
        voicePairRef.current = selectVoicePair(fresh);
      }
    }

    const utter = new SpeechSynthesisUtterance(next.text);
    const chosen =
      next.speaker === 'host' ? voicePairRef.current.host : voicePairRef.current.guest;
    if (chosen) utter.voice = chosen;
    // Strong pitch + rate distinction so even when the engine collapses to a
    // single voice (some Linux/iOS configs) the host and guest sound different.
    if (next.speaker === 'host') {
      utter.rate = 1.02;
      utter.pitch = 1.18;
    } else {
      utter.rate = 0.97;
      utter.pitch = 0.82;
    }
    utter.volume = 1;
    utter.onend = () => {
      speakingRef.current = false;
      utteranceRef.current = null;
      setTimeout(() => speakNext(), 30);
    };
    utter.onerror = () => {
      speakingRef.current = false;
      utteranceRef.current = null;
      setTimeout(() => speakNext(), 30);
    };
    utteranceRef.current = utter;
    window.speechSynthesis.speak(utter);
  }, [speechSupported]);

  const cancelSpeech = useCallback(() => {
    if (!speechSupported) return;
    speakingRef.current = false;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    utteranceRef.current = null;
  }, [speechSupported]);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      try {
        eventSourceRef.current.close();
      } catch {
        /* ignore */
      }
      eventSourceRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    closeStream();
    cancelSpeech();
    queueRef.current = [];
    lastSegmentIndexRef.current = -1;
    setCurrentSegment(null);
    setSessionId(null);
    setStreamFinished(false);
    setQuestionInput('');
    setTopic('');
    setTopicInput('');
    setError(null);
    setPhase('idle');
  }, [cancelSpeech, closeStream]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      closeStream();
      cancelSpeech();
    };
  }, [closeStream, cancelSpeech]);

  const openStream = useCallback(
    (id: string, sinceIndex = 0) => {
      closeStream();
      const sinceParam = sinceIndex > 0 ? `?since=${sinceIndex}` : '';
      const url = toApiUrl(`/api/cast/${encodeURIComponent(id)}/stream${sinceParam}`);
      const es = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = es;

      es.addEventListener('hello', () => {
        // no-op — server confirmed the session, just keeps stream alive.
      });

      es.addEventListener('segment', (event) => {
        try {
          const segment = JSON.parse((event as MessageEvent).data) as CastSegment;
          if (typeof segment?.text !== 'string' || !segment.text.trim()) return;
          if (typeof segment.index === 'number' && segment.index > lastSegmentIndexRef.current) {
            lastSegmentIndexRef.current = segment.index;
          }
          queueRef.current.push(segment);
          if (!speakingRef.current) speakNext();
        } catch {
          /* ignore malformed payload */
        }
      });

      es.addEventListener('done', () => {
        setStreamFinished(true);
        closeStream();
      });

      es.addEventListener('error', () => {
        if (!queueRef.current.length && !speakingRef.current && !streamFinished) {
          setError('Lost connection. Tap Restart to try again.');
          setPhase('error');
        }
        closeStream();
      });
    },
    [closeStream, speakNext, streamFinished],
  );

  const startCast = useCallback(
    async (rawTopic: string) => {
      const trimmed = rawTopic.trim();
      if (!trimmed) {
        setError('Type a topic first.');
        return;
      }
      setError(null);
      setPhase('starting');
      try {
        const res = await apiFetch('/api/cast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: trimmed }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Server returned ${res.status}`);
        }
        const data = (await res.json()) as { id: string; topic: string };
        setSessionId(data.id);
        setTopic(data.topic);
        setStreamFinished(false);
        lastSegmentIndexRef.current = -1;
        setPhase('playing');
        openStream(data.id, 0);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start podcast.';
        setError(message);
        setPhase('error');
      }
    },
    [openStream],
  );

  const handleStartSubmit = (e: FormEvent) => {
    e.preventDefault();
    void startCast(topicInput);
  };

  const handleAskOpen = useCallback(() => {
    if (!sessionId) return;
    // Stop the show while the listener is typing — but DON'T close the stream
    // here. The server is still emitting outline beats; we just suppress
    // playback. When the question lands the server will swap to answer beats
    // and we'll resume audio with those.
    cancelSpeech();
    queueRef.current = [];
    setCurrentSegment(null);
    setQuestionInput('');
    setPhase('asking');
  }, [cancelSpeech, sessionId]);

  const handleAskCancel = useCallback(() => {
    setQuestionInput('');
    setPhase('playing');
    // If the stream had already wrapped (event: done), reopen from where we
    // left off so further activity (or another question) keeps working.
    if (sessionId && !eventSourceRef.current) {
      setStreamFinished(false);
      openStream(sessionId, lastSegmentIndexRef.current + 1);
    }
  }, [openStream, sessionId]);

  const handleAskSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const q = questionInput.trim();
      if (!q || !sessionId) return;
      try {
        const res = await apiFetch(`/api/cast/${encodeURIComponent(sessionId)}/question`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || `Server returned ${res.status}`);
        }
        // Drop any segments that streamed in while the listener was typing —
        // we want the next thing they hear to be the host addressing their
        // question, not stale outline content.
        queueRef.current = [];
        cancelSpeech();
        // Reopen from the next unheard segment (the answer beat the server
        // queues will start at lastIndex+1 onward). If the stream is still
        // open we leave it — the server will pick up the question on its
        // next iteration and emit the answer beats.
        if (!eventSourceRef.current) {
          setStreamFinished(false);
          openStream(sessionId, lastSegmentIndexRef.current + 1);
        }
        setQuestionInput('');
        setPhase('playing');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send your question.';
        setError(message);
        setPhase('error');
      }
    },
    [cancelSpeech, openStream, questionInput, sessionId],
  );

  const speakerLabel = currentSegment
    ? currentSegment.speaker === 'host'
      ? `${HOST_NAME} · host`
      : `${GUEST_NAME} · guest`
    : streamFinished
      ? 'Episode wrapped'
      : phase === 'starting'
        ? 'Cueing the studio…'
        : phase === 'playing'
          ? 'Connecting…'
          : '';

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#050510] via-[#0d0d22] to-[#1a0d2e] text-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(167, 139, 250, 0.35), transparent 45%), radial-gradient(circle at 80% 80%, rgba(56, 189, 248, 0.25), transparent 45%)',
        }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-between px-6 py-12">
        <header className="w-full text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-white/50">
            PodCraft
          </p>
          <p className="mt-1 text-sm text-white/40">In-car AI podcast. One topic. Press Go.</p>
        </header>

        {phase === 'idle' || phase === 'starting' || phase === 'error' ? (
          <section className="flex w-full flex-col items-center gap-8">
            <h1 className="text-center text-5xl font-bold leading-tight sm:text-6xl">
              What should we talk about?
            </h1>
            <form onSubmit={handleStartSubmit} className="flex w-full flex-col items-center gap-4">
              <input
                autoFocus
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                placeholder="e.g. the Apollo program, why bees matter, modern jazz"
                className="w-full rounded-2xl border border-white/15 bg-white/10 px-6 py-5 text-center text-xl font-medium text-white placeholder-white/40 outline-none ring-0 transition focus:border-white/40 focus:bg-white/15"
                maxLength={200}
                disabled={phase === 'starting'}
                aria-label="Podcast topic"
              />
              <button
                type="submit"
                disabled={phase === 'starting' || !topicInput.trim()}
                className="rounded-full bg-white px-12 py-5 text-2xl font-bold text-black transition disabled:opacity-50 active:scale-95 hover:bg-white/90"
              >
                {phase === 'starting' ? 'Starting…' : 'Go'}
              </button>
              {error ? (
                <p className="rounded-xl bg-red-500/20 px-4 py-2 text-sm text-red-200" role="alert">
                  {error}
                </p>
              ) : null}
            </form>
            {!speechSupported ? (
              <p className="max-w-md text-center text-xs text-amber-300/80">
                This browser doesn’t support speech synthesis — you’ll see the text but not hear it.
                Try Chrome, Safari, or Edge.
              </p>
            ) : null}
          </section>
        ) : null}

        {phase === 'playing' ? (
          <section className="flex w-full flex-1 flex-col items-center justify-center gap-10">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.3em] text-white/50">Now playing</p>
              <h2 className="mt-2 text-4xl font-bold sm:text-5xl">{topic}</h2>
            </div>
            <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white/5 px-6 py-8 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/50">
                {speakerLabel}
              </p>
              <p className="mt-3 text-2xl font-medium leading-snug text-white sm:text-3xl">
                {currentSegment?.text || (streamFinished ? 'Tap “New topic” to start another conversation.' : '…')}
              </p>
            </div>
            <button
              type="button"
              onClick={handleAskOpen}
              className="flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-orange-400 text-2xl font-extrabold uppercase tracking-widest text-white shadow-[0_20px_60px_-20px_rgba(244,114,182,0.7)] transition active:scale-95"
              aria-label="Interrupt and ask a question"
            >
              Ask
            </button>
            <button
              type="button"
              onClick={reset}
              className="text-sm text-white/50 underline-offset-4 hover:text-white/80 hover:underline"
            >
              New topic
            </button>
          </section>
        ) : null}

        {phase === 'asking' ? (
          <section className="flex w-full flex-1 flex-col items-center justify-center gap-8">
            <div className="text-center">
              <p className="text-sm uppercase tracking-[0.3em] text-white/50">Your question</p>
              <h2 className="mt-2 text-3xl font-bold sm:text-4xl">{topic}</h2>
            </div>
            <form onSubmit={handleAskSubmit} className="flex w-full max-w-2xl flex-col items-center gap-4">
              <input
                autoFocus
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                placeholder="Type your question"
                className="w-full rounded-2xl border border-white/15 bg-white/10 px-6 py-5 text-center text-xl font-medium text-white placeholder-white/40 outline-none focus:border-white/40 focus:bg-white/15"
                maxLength={500}
                aria-label="Your question"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleAskCancel}
                  className="rounded-full border border-white/30 px-8 py-4 text-lg font-semibold text-white/80 transition hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!questionInput.trim()}
                  className="rounded-full bg-white px-10 py-4 text-lg font-bold text-black transition disabled:opacity-50 active:scale-95"
                >
                  Send
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <footer className="mt-8 text-center text-[11px] text-white/30">
          Drive safely · keep eyes on the road · ask hands-free when possible
        </footer>
      </div>
    </main>
  );
}
