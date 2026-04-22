'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface TranscriptTurn {
  id: string;
  speaker: 'host' | 'guest';
  speakerLabel: 'Host' | 'Guest';
  text: string;
}

interface TranscriptPlayerProps {
  transcript: TranscriptTurn[];
}

export default function TranscriptPlayer({ transcript }: TranscriptPlayerProps) {
  const [supported, setSupported] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(-1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const turnIndexRef = useRef(-1);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setSupported(true);

    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) setVoices(v);
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      window.speechSynthesis.cancel();
    };
  }, []);

  const pickVoice = useCallback(
    (speaker: 'host' | 'guest'): SpeechSynthesisVoice | null => {
      const enVoices = voices.filter((v) => v.lang.startsWith('en'));
      if (enVoices.length === 0) return voices[0] ?? null;
      if (enVoices.length === 1) return enVoices[0];
      // Pick two distinct voices for host and guest
      return speaker === 'host' ? enVoices[0] : enVoices[Math.min(1, enVoices.length - 1)];
    },
    [voices],
  );

  const speakTurn = useCallback(
    (index: number) => {
      if (index >= transcript.length) {
        setPlaying(false);
        setCurrentTurnIndex(-1);
        turnIndexRef.current = -1;
        return;
      }

      if (cancelledRef.current) return;

      const turn = transcript[index];
      const utterance = new SpeechSynthesisUtterance(turn.text);
      utterance.rate = 1.05;
      utterance.pitch = turn.speaker === 'host' ? 1.0 : 0.85;
      const voice = pickVoice(turn.speaker);
      if (voice) utterance.voice = voice;

      utterance.onend = () => {
        if (!cancelledRef.current) {
          speakTurn(index + 1);
        }
      };

      utterance.onerror = (e) => {
        if (e.error !== 'canceled') {
          speakTurn(index + 1);
        }
      };

      utteranceRef.current = utterance;
      turnIndexRef.current = index;
      setCurrentTurnIndex(index);
      window.speechSynthesis.speak(utterance);
    },
    [transcript, pickVoice],
  );

  const handlePlay = useCallback(() => {
    if (playing) {
      cancelledRef.current = true;
      window.speechSynthesis.cancel();
      setPlaying(false);
      setCurrentTurnIndex(-1);
      turnIndexRef.current = -1;
      cancelledRef.current = false;
      return;
    }

    cancelledRef.current = false;
    setPlaying(true);
    speakTurn(0);
  }, [playing, speakTurn]);

  const handleStop = useCallback(() => {
    cancelledRef.current = true;
    window.speechSynthesis.cancel();
    setPlaying(false);
    setCurrentTurnIndex(-1);
    turnIndexRef.current = -1;
    cancelledRef.current = false;
  }, []);

  // Cleanup on unmount or transcript change
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      window.speechSynthesis?.cancel();
    };
  }, [transcript]);

  if (!supported) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        Audio synthesis is not available. Read the transcript below instead.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button
          onClick={handlePlay}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700 active:scale-[0.98]"
        >
          {playing ? (
            <>
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              Pause
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Listen with Text-to-Speech
            </>
          )}
        </button>
        {playing && (
          <button
            onClick={handleStop}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            Stop
          </button>
        )}
        {playing && currentTurnIndex >= 0 && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Turn {currentTurnIndex + 1} of {transcript.length}
          </span>
        )}
      </div>

      {/* Highlight currently speaking turn */}
      {playing && currentTurnIndex >= 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-800 dark:bg-violet-900/30">
          <p className="text-xs font-semibold uppercase tracking-wider text-violet-500 dark:text-violet-400">
            {transcript[currentTurnIndex].speakerLabel}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-violet-900 dark:text-violet-100">
            {transcript[currentTurnIndex].text}
          </p>
        </div>
      )}
    </div>
  );
}
