'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { useInteractiveSession } from '../../../hooks/useInteractiveSession';
import SegmentPlayer from '../../../components/SegmentPlayer';
import InterruptInput from '../../../components/InterruptInput';
import SessionTranscript from '../../../components/SessionTranscript';

export default function SessionPlayerPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : params.sessionId?.[0] ?? '';
  const {
    session,
    loading,
    error,
    interruptLoading,
    clearError,
    loadSession,
    getSegmentAudioUrl,
    submitInterrupt,
  } = useInteractiveSession();
  const [authChecked, setAuthChecked] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((res) => {
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        setAuthChecked(true);
        if (sessionId) loadSession(sessionId);
      })
      .catch(() => router.push('/login'));
  }, [router, sessionId, loadSession]);

  const handleInterrupt = useCallback(async (text: string, inputMethod: 'voice' | 'text') => {
    if (!session) return;

    const currentSegment = session.segments[currentSegmentIndex];
    if (!currentSegment) return;

    clearError();
    const updated = await submitInterrupt({
      sessionId: session.id,
      questionText: text,
      inputMethod,
      afterSegmentId: currentSegment.id,
    });

    if (updated) {
      // Jump to the first new segment (right after the interrupt point)
      const activeSegments = updated.segments;
      const newStart = activeSegments.findIndex(
        (s: { generatedAfterInterrupt?: string }) =>
          s.generatedAfterInterrupt === updated.interrupts[updated.interrupts.length - 1]?.id,
      );
      if (newStart !== -1) {
        setCurrentSegmentIndex(newStart);
      }
    }
  }, [session, currentSegmentIndex, clearError, submitInterrupt]);

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
          <p className="text-lg font-medium text-gray-500">
            {error || 'Session not found'}
          </p>
          <Link
            href="/podcasts/sessions"
            className="mt-4 inline-block rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            Back to Sessions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/podcasts/sessions"
          className="text-sm text-gray-500 hover:text-gray-700 transition"
        >
          ← Back to Sessions
        </Link>
        <h1 className="mt-2 text-xl font-bold text-gray-900 sm:text-2xl">
          {session.title}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{session.summary}</p>
        <div className="mt-2 flex gap-3 text-xs text-gray-400">
          <span>{session.segments.length} segments</span>
          {session.interrupts.length > 0 && (
            <span className="text-amber-500">
              {session.interrupts.length} interrupt{session.interrupts.length !== 1 ? 's' : ''}
            </span>
          )}
          <span>Rev {session.revision}</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={clearError} className="ml-2 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Player */}
      <div className="mb-4">
        <SegmentPlayer
          segments={session.segments}
          sessionId={session.id}
          getAudioUrl={getSegmentAudioUrl}
          currentSegmentIndex={currentSegmentIndex}
          onSegmentChange={setCurrentSegmentIndex}
          disabled={interruptLoading}
        />
      </div>

      {/* Interrupt loading indicator */}
      {interruptLoading && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-700">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
          Processing your question — the host is incorporating it into the interview…
        </div>
      )}

      {/* Interrupt input */}
      <div className="mb-4">
        <InterruptInput
          onSubmit={handleInterrupt}
          disabled={interruptLoading}
          loading={interruptLoading}
        />
      </div>

      {/* Transcript */}
      <SessionTranscript
        segments={session.segments}
        interrupts={session.interrupts}
        currentSegmentIndex={currentSegmentIndex}
        onSegmentClick={setCurrentSegmentIndex}
      />
    </div>
  );
}
