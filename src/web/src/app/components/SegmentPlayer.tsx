'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Segment } from '../hooks/useInteractiveSession';

interface SegmentPlayerProps {
  segments: Segment[];
  sessionId: string;
  getAudioUrl: (sessionId: string, segmentId: string) => Promise<string | null>;
  currentSegmentIndex: number;
  onSegmentChange: (index: number) => void;
  disabled?: boolean;
}

const PREFETCH_COUNT = 3;

export default function SegmentPlayer({
  segments,
  sessionId,
  getAudioUrl,
  currentSegmentIndex,
  onSegmentChange,
  disabled,
}: SegmentPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioUrls, setAudioUrls] = useState<Map<string, string>>(new Map());
  const prefetchingRef = useRef<Set<string>>(new Set());

  const currentSegment = segments[currentSegmentIndex];

  // Prefetch audio for upcoming segments
  const prefetchAudio = useCallback(async (fromIndex: number) => {
    for (let i = fromIndex; i < Math.min(fromIndex + PREFETCH_COUNT, segments.length); i++) {
      const seg = segments[i];
      if (!seg || audioUrls.has(seg.id) || prefetchingRef.current.has(seg.id)) continue;
      prefetchingRef.current.add(seg.id);
      const url = await getAudioUrl(sessionId, seg.id);
      if (url) {
        setAudioUrls((prev) => new Map(prev).set(seg.id, url));
      }
      prefetchingRef.current.delete(seg.id);
    }
  }, [segments, sessionId, getAudioUrl, audioUrls]);

  // Prefetch on mount and when segment changes
  useEffect(() => {
    prefetchAudio(currentSegmentIndex); // eslint-disable-line react-hooks/set-state-in-effect
  }, [currentSegmentIndex, prefetchAudio]);

  // Load and play current segment audio
  useEffect(() => {
    if (!currentSegment || disabled) return;

    const url = audioUrls.get(currentSegment.id);
    if (url && audioRef.current) {
      audioRef.current.src = url;
      if (playing) {
        audioRef.current.play().catch(() => {});
      }
    } else if (!url) {
      setAudioLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
      getAudioUrl(sessionId, currentSegment.id).then((fetchedUrl) => {
        if (fetchedUrl) {
          setAudioUrls((prev) => new Map(prev).set(currentSegment.id, fetchedUrl));
          if (audioRef.current) {
            audioRef.current.src = fetchedUrl;
            if (playing) {
              audioRef.current.play().catch(() => {});
            }
          }
        }
        setAudioLoading(false);
      });
    }
  }, [currentSegment, audioUrls, sessionId, getAudioUrl, playing, disabled]);

  const handleEnded = useCallback(() => {
    if (currentSegmentIndex < segments.length - 1) {
      onSegmentChange(currentSegmentIndex + 1);
    } else {
      setPlaying(false);
    }
  }, [currentSegmentIndex, segments.length, onSegmentChange]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  }, [playing]);

  const goToPrev = useCallback(() => {
    if (currentSegmentIndex > 0) {
      onSegmentChange(currentSegmentIndex - 1);
    }
  }, [currentSegmentIndex, onSegmentChange]);

  const goToNext = useCallback(() => {
    if (currentSegmentIndex < segments.length - 1) {
      onSegmentChange(currentSegmentIndex + 1);
    }
  }, [currentSegmentIndex, segments.length, onSegmentChange]);

  // Clear stale audio URLs when segments change (after interrupt)
  const segmentIds = segments.map((s) => s.id).join(',');
  useEffect(() => {
    const segIds = new Set(segmentIds.split(','));
    setAudioUrls((prev) => { // eslint-disable-line react-hooks/set-state-in-effect
      let changed = false;
      for (const id of prev.keys()) {
        if (!segIds.has(id)) { changed = true; break; }
      }
      if (!changed) return prev;
      const next = new Map<string, string>();
      for (const [id, url] of prev) {
        if (segIds.has(id)) {
          next.set(id, url);
        } else {
          URL.revokeObjectURL(url);
        }
      }
      return next;
    });
  }, [segmentIds]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <audio ref={audioRef} onEnded={handleEnded} className="hidden" />

      {/* Segment indicator */}
      <div className="mb-3 text-center text-sm font-medium text-gray-500">
        Segment {currentSegmentIndex + 1} of {segments.length}
        {audioLoading && <span className="ml-2 text-violet-600">Loading audio…</span>}
      </div>

      {/* Progress bar */}
      <div className="mb-4 flex gap-1">
        {segments.map((seg, i) => (
          <button
            key={seg.id}
            onClick={() => onSegmentChange(i)}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i === currentSegmentIndex
                ? 'bg-violet-600'
                : i < currentSegmentIndex
                  ? 'bg-violet-300'
                  : 'bg-gray-200'
            }`}
            aria-label={`Go to segment ${i + 1}`}
          />
        ))}
      </div>

      {/* Current segment text */}
      {currentSegment && (
        <div className="mb-4 space-y-2 rounded-xl bg-gray-50 p-3">
          <p className="text-sm">
            <span className="font-semibold text-violet-700">Host:</span>{' '}
            <span className="text-gray-700">{currentSegment.hostLine}</span>
          </p>
          <p className="text-sm">
            <span className="font-semibold text-emerald-700">Guest:</span>{' '}
            <span className="text-gray-700">{currentSegment.guestLine}</span>
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={goToPrev}
          disabled={currentSegmentIndex === 0 || disabled}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition hover:bg-gray-200 disabled:opacity-40 disabled:hover:bg-gray-100"
          aria-label="Previous segment"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          onClick={togglePlay}
          disabled={disabled || !currentSegment}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg transition hover:bg-violet-700 disabled:opacity-40"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <button
          onClick={goToNext}
          disabled={currentSegmentIndex >= segments.length - 1 || disabled}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition hover:bg-gray-200 disabled:opacity-40 disabled:hover:bg-gray-100"
          aria-label="Next segment"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
