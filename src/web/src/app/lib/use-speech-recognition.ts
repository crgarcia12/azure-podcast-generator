'use client';

// React hook wrapping the Web Speech API's SpeechRecognition for hands-free
// listener questions. The interview-style podcast is meant to be consumed
// while driving, so the "Ask" flow defaults to voice input when the browser
// supports it. We intentionally use the in-browser engine instead of a
// server-side STT round-trip — it's free, low-latency, and works offline-ish.
//
// Browser support note: Chrome, Edge, and Safari all expose this API today
// (Safari prefixed it as `webkitSpeechRecognition`). Firefox does not. The
// `isSupported` flag lets the UI fall back to typed input cleanly.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Minimal type definitions for the Web Speech API to avoid relying on the
// `dom-speech-recognition` TS lib (which isn't in this project) while still
// giving us strict typing where it matters.
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type SpeechRecognitionStatus =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'stopped'
  | 'error';

export interface UseSpeechRecognitionResult {
  // Whether the browser exposes a SpeechRecognition implementation at all.
  isSupported: boolean;
  // Current status of the recognition session.
  status: SpeechRecognitionStatus;
  // Concatenated final transcripts from this session.
  finalTranscript: string;
  // Latest interim (non-final) hypothesis from the engine. Useful for live
  // visual feedback so the listener can see they're being heard.
  interimTranscript: string;
  // Friendly error message, or null when there's no error.
  error: string | null;
  // Begins listening. Resets transcripts on each call. Idempotent.
  start: () => void;
  // Stops listening (graceful, will fire onend, will deliver pending finals).
  stop: () => void;
  // Aborts immediately without delivering pending finals. Used on cancel.
  abort: () => void;
  // Resets transcripts and error state without touching the engine.
  reset: () => void;
}

export interface UseSpeechRecognitionOptions {
  // BCP-47 language tag, e.g. "en-US". Defaults to the browser's current
  // language preference and falls back to "en-US".
  lang?: string;
  // When true, recognition keeps going until stop()/abort(). When false (the
  // default), the browser auto-stops on natural end-of-speech which is what
  // we want for short listener questions.
  continuous?: boolean;
  // Called once the engine fires its terminal `onend` event with the final
  // accumulated transcript. The transcript is trimmed; an empty string means
  // the listener didn't say anything intelligible.
  onFinalResult?: (finalTranscript: string) => void;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionResult {
  const { lang, continuous = false, onFinalResult } = options;

  const ctor = useMemo(getSpeechRecognitionCtor, []);
  const isSupported = ctor !== null;

  const [status, setStatus] = useState<SpeechRecognitionStatus>('idle');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Hold the active recognition instance + a ref to the latest final
  // transcript so the onend handler can deliver it to the caller without
  // a stale closure.
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef('');
  const onFinalResultRef = useRef<typeof onFinalResult>(undefined);
  // Track whether we explicitly aborted so onend doesn't fire onFinalResult.
  const abortedRef = useRef(false);

  useEffect(() => {
    onFinalResultRef.current = onFinalResult;
  }, [onFinalResult]);

  const reset = useCallback(() => {
    setFinalTranscript('');
    setInterimTranscript('');
    setError(null);
    finalTranscriptRef.current = '';
  }, []);

  const stop = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    try {
      r.stop();
    } catch {
      // Engine already stopped — safe to ignore.
    }
  }, []);

  const abort = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) return;
    abortedRef.current = true;
    try {
      r.abort();
    } catch {
      // Same as stop — engine may already be torn down.
    }
  }, []);

  const start = useCallback(() => {
    if (!ctor) {
      setError('Speech recognition is not supported in this browser.');
      setStatus('error');
      return;
    }
    // Tear down any prior instance so start() is idempotent.
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }

    abortedRef.current = false;
    finalTranscriptRef.current = '';
    setFinalTranscript('');
    setInterimTranscript('');
    setError(null);

    let instance: SpeechRecognitionLike;
    try {
      instance = new ctor();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
      return;
    }

    instance.lang = lang
      || (typeof navigator !== 'undefined' && navigator.language)
      || 'en-US';
    instance.continuous = continuous;
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    instance.onstart = () => {
      setStatus('listening');
    };

    instance.onresult = (ev: SpeechRecognitionEventLike) => {
      let interim = '';
      let appendedFinal = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (!result) continue;
        const alt = result[0];
        if (!alt) continue;
        if (result.isFinal) {
          appendedFinal += (appendedFinal ? ' ' : '') + alt.transcript.trim();
        } else {
          interim += alt.transcript;
        }
      }
      if (appendedFinal) {
        const next = (finalTranscriptRef.current
          ? `${finalTranscriptRef.current} ${appendedFinal}`
          : appendedFinal
        ).replace(/\s+/g, ' ').trim();
        finalTranscriptRef.current = next;
        setFinalTranscript(next);
      }
      setInterimTranscript(interim.trim());
    };

    instance.onerror = (ev: SpeechRecognitionErrorEventLike) => {
      const code = ev.error || 'unknown';
      const message = (() => {
        switch (code) {
          case 'not-allowed':
          case 'service-not-allowed':
            return 'Microphone permission was denied. Allow access in your browser settings, or type your question instead.';
          case 'no-speech':
            return "I didn't hear anything. Try again, or type your question.";
          case 'audio-capture':
            return 'No microphone was found. Plug one in or type your question instead.';
          case 'network':
            return 'Voice recognition needs a network connection.';
          case 'aborted':
            return null;
          default:
            return ev.message || `Voice recognition error: ${code}.`;
        }
      })();
      if (message) {
        setError(message);
        setStatus('error');
      }
    };

    instance.onend = () => {
      const wasAborted = abortedRef.current;
      const transcript = finalTranscriptRef.current.trim();
      // Reset for the next session.
      recognitionRef.current = null;
      setInterimTranscript('');
      setStatus((prev) => (prev === 'error' ? 'error' : 'stopped'));
      if (!wasAborted) {
        onFinalResultRef.current?.(transcript);
      }
    };

    recognitionRef.current = instance;
    setStatus('starting');
    try {
      instance.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
      recognitionRef.current = null;
    }
  }, [continuous, ctor, lang]);

  useEffect(() => {
    return () => {
      const r = recognitionRef.current;
      if (r) {
        try {
          r.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isSupported,
    status,
    finalTranscript,
    interimTranscript,
    error,
    start,
    stop,
    abort,
    reset,
  };
}
