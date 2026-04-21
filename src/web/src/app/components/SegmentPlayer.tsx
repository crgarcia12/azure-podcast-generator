'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Segment } from '../hooks/useInteractiveSession';

interface SegmentPlayerProps {
  segments: Segment[];
  sessionId: string;
  getAudioUrl: (sessionId: string, segmentId: string) => Promise<string | null>;
  currentSegmentIndex: number;
  onSegmentChange: (index: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  autoPlay?: boolean;
  disabled?: boolean;
}

const PREFETCH_COUNT = 3;

export default function SegmentPlayer({
  segments,
  sessionId,
  getAudioUrl,
  currentSegmentIndex,
  onSegmentChange,
  onPlayingChange,
  autoPlay = false,
  disabled,
}: SegmentPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioUrls, setAudioUrls] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const prefetchingRef = useRef<Set<string>>(new Set());
  const autoPlayRef = useRef(autoPlay);

  const currentSegment = segments[currentSegmentIndex];
  const isComplete = currentSegmentIndex >= segments.length - 1 && !playing;

  useEffect(() => { autoPlayRef.current = autoPlay; }, [autoPlay]);
  useEffect(() => { onPlayingChange?.(playing); }, [playing, onPlayingChange]);

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

  useEffect(() => {
    prefetchAudio(currentSegmentIndex); // eslint-disable-line react-hooks/set-state-in-effect
  }, [currentSegmentIndex, prefetchAudio]);

  useEffect(() => {
    if (!currentSegment || disabled) return;
    const url = audioUrls.get(currentSegment.id);
    if (url && audioRef.current) {
      audioRef.current.src = url;
      if (playing || autoPlayRef.current) {
        audioRef.current.play().catch(() => {});
        if (!playing) setPlaying(true);
      }
    } else if (!url) {
      setAudioLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
      getAudioUrl(sessionId, currentSegment.id).then((fetchedUrl) => {
        if (fetchedUrl) {
          setAudioUrls((prev) => new Map(prev).set(currentSegment.id, fetchedUrl));
          if (audioRef.current) {
            audioRef.current.src = fetchedUrl;
            if (playing || autoPlayRef.current) {
              audioRef.current.play().catch(() => {});
              if (!playing) setPlaying(true);
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

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setProgress(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  }, []);

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
    if (currentSegmentIndex > 0) onSegmentChange(currentSegmentIndex - 1);
  }, [currentSegmentIndex, onSegmentChange]);

  const goToNext = useCallback(() => {
    if (currentSegmentIndex < segments.length - 1) onSegmentChange(currentSegmentIndex + 1);
  }, [currentSegmentIndex, segments.length, onSegmentChange]);

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

  const formatTime = (s: number) => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <audio ref={audioRef} onEnded={handleEnded} onTimeUpdate={handleTimeUpdate} className="hidden" />

      {/* Segment progress bar */}
      <div className="flex gap-0.5 px-4 pt-4">
        {segments.map((seg, i) => (
          <button
            key={seg.id}
            onClick={() => onSegmentChange(i)}
            className={`h-1 flex-1 rounded-full transition-colors ${
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

      <div className="px-4 pt-2 text-center">
        <div className="text-xs text-gray-400">
          Segment {currentSegmentIndex + 1} of {segments.length}
          {audioLoading && <span className="ml-2 text-violet-600">Loading…</span>}
        </div>
      </div>

      {currentSegment && (
        <div className="mx-4 mt-2 space-y-1.5 rounded-xl bg-gray-50 p-3">
          <p className="text-sm leading-snug">
            <span className="font-semibold text-violet-700">Host:</span>{' '}
            <span className="text-gray-700">{currentSegment.hostLine}</span>
          </p>
          <p className="text-sm leading-snug">
            <span className="font-semibold text-emerald-700">Guest:</span>{' '}
            <span className="text-gray-700">{currentSegment.guestLine}</span>
          </p>
        </div>
      )}

      {duration > 0 && (
        <div className="px-4 mt-2 flex items-center gap-2 text-[10px] text-gray-400">
          <span>{formatTime(progress)}</span>
          <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-violet-400 rounded-full transition-all"
              style={{ width: `${(progress / duration) * 100}%` }}
            />
          </div>
          <span>{formatTime(duration)}</span>
        </div>
      )}

      <div className="flex items-center justify-center gap-4 p-4">
        <button
          onClick={goToPrev}
          disabled={currentSegmentIndex === 0 || disabled}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition hover:bg-gray-200 disabled:opacity-30"
          aria-label="Previous segment"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          onClick={togglePlay}
          disabled={disabled || !currentSegment}
          className={`flex h-16 w-16 items-center justify-center rounded-full shadow-lg transition ${
            playing
              ? 'bg-amber-500 hover:bg-amber-600 text-white'
              : isComplete
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-violet-600 hover:bg-violet-700 text-white'
          } disabled:opacity-40`}
          aria-label={playing ? 'Pause' : isComplete ? 'Replay' : 'Play'}
        >
          {playing ? (
            <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="h-7 w-7 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <button
          onClick={goToNext}
          disabled={currentSegmentIndex >= segments.length - 1 || disabled}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition hover:bg-gray-200 disabled:opacity-30"
          aria-label="Next segment"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
