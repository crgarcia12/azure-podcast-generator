'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface InterruptInputProps {
  onSubmit: (text: string, inputMethod: 'voice' | 'text') => void;
  disabled?: boolean;
  loading?: boolean;
}

// Web Speech API types (not available in all browsers)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  length: number;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

// Check browser support for Web Speech API
function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const win = window as any;
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export default function InterruptInput({ onSubmit, disabled, loading }: InterruptInputProps) {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [autoSend, setAutoSend] = useState(false);
  const [speechSupported] = useState(() =>
    typeof window !== 'undefined' && getSpeechRecognition() !== null
  );
  const [undoTimer, setUndoTimer] = useState<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setRecording(false);
  }, []);

  const startRecording = useCallback(() => {
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const results = event.results;
      const result = results[results.length - 1]?.[0]?.transcript ?? '';
      if (result.trim()) {
        if (autoSend) {
          // Auto-send with undo window
          setTranscript(result.trim());
          setShowReview(false);
          setRecording(false);

          let countdown = 3;
          setUndoTimer(countdown);
          const interval = setInterval(() => {
            countdown -= 1;
            setUndoTimer(countdown);
            if (countdown <= 0) {
              clearInterval(interval);
              setUndoTimer(null);
              onSubmit(result.trim(), 'voice');
              setTranscript('');
            }
          }, 1000);
          undoTimeoutRef.current = interval;
        } else {
          setTranscript(result.trim());
          setShowReview(true);
        }
      }
    };

    recognition.onerror = () => {
      setRecording(false);
    };

    recognition.onend = () => {
      setRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }, [autoSend, onSubmit]);

  const toggleRecording = useCallback(() => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [recording, stopRecording, startRecording]);

  const handleSendVoice = useCallback(() => {
    if (transcript.trim()) {
      onSubmit(transcript.trim(), 'voice');
      setTranscript('');
      setShowReview(false);
    }
  }, [transcript, onSubmit]);

  const handleCancelVoice = useCallback(() => {
    setTranscript('');
    setShowReview(false);
  }, []);

  const handleUndoAutoSend = useCallback(() => {
    if (undoTimeoutRef.current) {
      clearInterval(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    setUndoTimer(null);
    setTranscript('');
  }, []);

  const handleTextSubmit = useCallback(() => {
    if (text.trim().length >= 5) {
      onSubmit(text.trim(), 'text');
      setText('');
    }
  }, [text, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  }, [handleTextSubmit]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Ask a question</h3>
        {speechSupported && (
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
              className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
            />
            Auto-send (driving mode)
          </label>
        )}
      </div>

      {/* Undo auto-send toast */}
      {undoTimer !== null && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm">
          <span className="text-amber-800">
            Sending in {undoTimer}s: &ldquo;{transcript.slice(0, 60)}{transcript.length > 60 ? '…' : ''}&rdquo;
          </span>
          <button
            onClick={handleUndoAutoSend}
            className="ml-2 rounded bg-amber-200 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-300"
          >
            Undo
          </button>
        </div>
      )}

      {/* Voice review panel */}
      {showReview && (
        <div className="mb-3 space-y-2 rounded-lg bg-violet-50 p-3">
          <p className="text-xs font-medium text-violet-600">Review your question:</p>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSendVoice}
              disabled={loading || transcript.trim().length < 5}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              Send
            </button>
            <button
              onClick={handleCancelVoice}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Main input row */}
      <div className="flex items-end gap-2">
        {/* Mic button */}
        {speechSupported && (
          <button
            onClick={toggleRecording}
            disabled={disabled || loading || showReview}
            className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full transition ${
              recording
                ? 'animate-pulse bg-red-500 text-white shadow-lg'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            } disabled:opacity-40`}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z"
              />
            </svg>
          </button>
        )}

        {/* Text input */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your question here…"
          disabled={disabled || loading}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm placeholder-gray-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
        />

        {/* Send button */}
        <button
          onClick={handleTextSubmit}
          disabled={disabled || loading || text.trim().length < 5}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-violet-600 text-white transition hover:bg-violet-700 disabled:opacity-40"
          aria-label="Send question"
        >
          {loading ? (
            <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
        </button>
      </div>

      {/* Speech not supported hint */}
      {!speechSupported && (
        <p className="mt-2 text-xs text-gray-400">
          Voice input is not available in this browser. Use text input instead.
        </p>
      )}

      {/* Recording indicator */}
      {recording && (
        <div className="mt-2 flex items-center gap-2 text-xs text-red-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          Listening… Speak your question, then press the mic button again.
        </div>
      )}
    </div>
  );
}
