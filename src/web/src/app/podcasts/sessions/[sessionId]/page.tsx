'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { useInteractiveSession, ChatMessage as ChatMessageType } from '../../../hooks/useInteractiveSession';
import SegmentPlayer from '../../../components/SegmentPlayer';
import InterruptInput from '../../../components/InterruptInput';
import SessionTranscript from '../../../components/SessionTranscript';
import ChatMessage from '../../../components/ChatMessage';
import TypingIndicator from '../../../components/TypingIndicator';

type Mode = 'listening' | 'editing';

export default function SessionPlayerPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : params.sessionId?.[0] ?? '';
  const {
    session,
    chatMessages,
    loading,
    error,
    interruptLoading,
    clearError,
    loadSession,
    getSegmentAudioUrl,
    sendChatMessage,
    updateProgress,
  } = useInteractiveSession();
  const [authChecked, setAuthChecked] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [mode, setMode] = useState<Mode>('listening');
  const [playing, setPlaying] = useState(false);
  const [autoPlayAfterEdit, setAutoPlayAfterEdit] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((res) => {
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        setAuthChecked(true);
        if (sessionId) {
          loadSession(sessionId).then((s) => {
            if (s && s.lastSegmentIndex > 0) {
              setCurrentSegmentIndex(Math.min(s.lastSegmentIndex, s.segments.length - 1));
            }
          });
        }
      })
      .catch(() => router.push('/login'));
  }, [router, sessionId, loadSession]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, interruptLoading]);

  // Debounced progress save
  useEffect(() => {
    if (!session) return;
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    progressTimerRef.current = setTimeout(() => {
      updateProgress(session.id, currentSegmentIndex);
    }, 2000);
    return () => {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    };
  }, [currentSegmentIndex, session, updateProgress]);

  const handlePlayingChange = useCallback((isPlaying: boolean) => {
    setPlaying(isPlaying);
  }, []);

  const handleEditClick = useCallback(() => {
    setMode('editing');
  }, []);

  const handleCancelEdit = useCallback(() => {
    setMode('listening');
  }, []);

  const handleChatSubmit = useCallback(async (text: string, inputMethod: 'voice' | 'text') => {
    if (!session) return;
    const currentSegment = session.segments[currentSegmentIndex];
    if (!currentSegment) return;

    clearError();
    const updated = await sendChatMessage({
      sessionId: session.id,
      message: text,
      inputMethod,
      afterSegmentId: currentSegment.id,
    });

    if (updated) {
      const activeSegments = updated.segments;
      const newStart = activeSegments.findIndex(
        (s: { generatedAfterInterrupt?: string }) =>
          s.generatedAfterInterrupt === updated.interrupts[updated.interrupts.length - 1]?.id,
      );
      if (newStart !== -1) {
        setCurrentSegmentIndex(newStart);
      }
      setMode('listening');
      setAutoPlayAfterEdit(true);
    }
  }, [session, currentSegmentIndex, clearError, sendChatMessage]);

  useEffect(() => {
    if (autoPlayAfterEdit && !interruptLoading) {
      const timer = setTimeout(() => setAutoPlayAfterEdit(false), 500);
      return () => clearTimeout(timer);
    }
  }, [autoPlayAfterEdit, interruptLoading]);

  if (!authChecked || (loading && !session)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-12 text-center">
          <p className="text-lg font-medium text-gray-500">{error || 'Session not found'}</p>
          <Link href="/podcasts/sessions" className="mt-4 inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700">
            Back to Sessions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
      {/* Compact header */}
      <div className="mb-3 flex items-center justify-between">
        <Link href="/podcasts/sessions" className="text-sm text-gray-400 hover:text-gray-600 transition">
          ← Back
        </Link>
        <div className="text-right">
          <h1 className="text-base font-bold text-gray-900 truncate max-w-[250px] sm:max-w-none">{session.title}</h1>
          <div className="flex gap-2 text-[10px] text-gray-400 justify-end">
            <span>{session.segments.length} segments</span>
            {session.interrupts.length > 0 && (
              <span className="text-amber-500">{session.interrupts.length} edits</span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
          <button onClick={clearError} className="ml-2 font-medium underline">Dismiss</button>
        </div>
      )}

      <div className="mb-3">
        <SegmentPlayer
          segments={session.segments}
          sessionId={session.id}
          getAudioUrl={getSegmentAudioUrl}
          currentSegmentIndex={currentSegmentIndex}
          onSegmentChange={setCurrentSegmentIndex}
          onPlayingChange={handlePlayingChange}
          autoPlay={autoPlayAfterEdit}
          disabled={interruptLoading}
        />
      </div>

      {/* Pause-to-edit prompt */}
      {!playing && mode === 'listening' && !interruptLoading && (
        <div className="mb-3">
          <button
            onClick={handleEditClick}
            className="w-full rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50 px-4 py-4 text-center transition hover:border-violet-400 hover:bg-violet-100"
          >
            <div className="flex items-center justify-center gap-2">
              <svg className="h-5 w-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span className="text-sm font-semibold text-violet-700">Edit Episode Flow</span>
            </div>
            <p className="mt-1 text-xs text-violet-500">Redirect the conversation from this point</p>
          </button>
        </div>
      )}

      {/* Editing mode */}
      {mode === 'editing' && (
        <div className="mb-3 rounded-2xl border border-violet-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-violet-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-violet-700">✏️ Edit from segment {currentSegmentIndex + 1}</h2>
            <button onClick={handleCancelEdit} className="text-xs text-gray-400 hover:text-gray-600 transition">Cancel</button>
          </div>

          {chatMessages.length > 0 && (
            <div className="max-h-48 overflow-y-auto px-4 py-3">
              {chatMessages.map((msg: ChatMessageType) => (
                <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
              ))}
              <TypingIndicator visible={interruptLoading} />
              <div ref={chatBottomRef} />
            </div>
          )}

          {interruptLoading && chatMessages.length === 0 && (
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-violet-700">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
                Regenerating episode…
              </div>
            </div>
          )}

          <div className="border-t border-violet-100 p-3">
            <InterruptInput onSubmit={handleChatSubmit} disabled={interruptLoading} loading={interruptLoading} />
          </div>
        </div>
      )}

      {/* Chat history (collapsed in listening mode) */}
      {mode === 'listening' && chatMessages.length > 0 && (
        <details className="mb-3 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-500 hover:text-gray-700">
            💬 {chatMessages.length} edit{chatMessages.length !== 1 ? 's' : ''} made
          </summary>
          <div className="max-h-48 overflow-y-auto px-4 pb-3">
            {chatMessages.map((msg: ChatMessageType) => (
              <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
            ))}
          </div>
        </details>
      )}

      <button
        onClick={() => setShowTranscript(!showTranscript)}
        className="mb-2 text-sm text-violet-600 hover:text-violet-800 font-medium transition"
      >
        {showTranscript ? '▼ Hide Full Transcript' : '▶ Show Full Transcript'}
      </button>

      {showTranscript && (
        <SessionTranscript
          segments={session.segments}
          interrupts={session.interrupts}
          currentSegmentIndex={currentSegmentIndex}
          onSegmentClick={setCurrentSegmentIndex}
        />
      )}
    </div>
  );
}
