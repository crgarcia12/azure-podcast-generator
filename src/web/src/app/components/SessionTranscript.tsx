'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Segment, Interrupt } from '../hooks/useInteractiveSession';

interface SessionTranscriptProps {
  segments: Segment[];
  interrupts: Interrupt[];
  currentSegmentIndex: number;
  onSegmentClick: (index: number) => void;
}

// Build an interleaved timeline of segments and interrupts
interface TimelineSegment {
  type: 'segment';
  segment: Segment;
}

interface TimelineInterrupt {
  type: 'interrupt';
  interrupt: Interrupt;
}

type TimelineItem = TimelineSegment | TimelineInterrupt;

function buildTimeline(segments: Segment[], interrupts: Interrupt[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const interruptsByAfter = new Map<string, Interrupt[]>();

  for (const interrupt of interrupts) {
    const list = interruptsByAfter.get(interrupt.afterSegmentId) ?? [];
    list.push(interrupt);
    interruptsByAfter.set(interrupt.afterSegmentId, list);
  }

  for (const segment of segments) {
    items.push({ type: 'segment', segment });
    const segInterrupts = interruptsByAfter.get(segment.id);
    if (segInterrupts) {
      for (const interrupt of segInterrupts) {
        items.push({ type: 'interrupt', interrupt });
      }
    }
  }

  return items;
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5">{part}</mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export default function SessionTranscript({
  segments,
  interrupts,
  currentSegmentIndex,
  onSegmentClick,
}: SessionTranscriptProps) {
  const activeRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Auto-scroll to current segment
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentSegmentIndex]);

  const timeline = buildTimeline(segments, interrupts);

  const { matchingIndices, matchCount } = useMemo(() => {
    if (!searchQuery.trim()) return { matchingIndices: new Set<number>(), matchCount: 0 };
    const q = searchQuery.toLowerCase();
    const indices = new Set<number>();
    for (const item of timeline) {
      if (item.type === 'segment') {
        const text = `${item.segment.hostLine} ${item.segment.guestLine}`.toLowerCase();
        if (text.includes(q)) indices.add(item.segment.index);
      }
    }
    return { matchingIndices: indices, matchCount: indices.size };
  }, [searchQuery, timeline]);

  const jumpToMatch = useCallback((direction: 'next' | 'prev') => {
    if (matchingIndices.size === 0) return;
    const sorted = [...matchingIndices].sort((a, b) => a - b);
    if (direction === 'next') {
      const next = sorted.find((i) => i > currentSegmentIndex) ?? sorted[0];
      onSegmentClick(next);
    } else {
      const prev = sorted.reverse().find((i) => i < currentSegmentIndex) ?? sorted[0];
      onSegmentClick(prev);
    }
  }, [matchingIndices, currentSegmentIndex, onSegmentClick]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">Transcript</h3>
          <div className="flex-1" />
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-40 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 placeholder:text-gray-400 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-200 sm:w-52"
            />
            {searchQuery && (
              <div className="ml-2 flex items-center gap-1">
                <span className="text-[10px] text-gray-400 whitespace-nowrap">
                  {matchCount} match{matchCount !== 1 ? 'es' : ''}
                </span>
                <button onClick={() => jumpToMatch('prev')} className="rounded p-0.5 text-gray-400 hover:text-gray-600" aria-label="Previous match">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                </button>
                <button onClick={() => jumpToMatch('next')} className="rounded p-0.5 text-gray-400 hover:text-gray-600" aria-label="Next match">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </button>
                <button onClick={() => setSearchQuery('')} className="rounded p-0.5 text-gray-400 hover:text-gray-600" aria-label="Clear search">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="max-h-96 overflow-y-auto p-4">
        <div className="space-y-3">
          {timeline.map((item) => {
            if (item.type === 'interrupt') {
              return (
                <div
                  key={`interrupt-${item.interrupt.id}`}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-amber-700">You asked:</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      item.interrupt.inputMethod === 'voice'
                        ? 'bg-violet-100 text-violet-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {item.interrupt.inputMethod === 'voice' ? '🎤 Voice' : '⌨️ Text'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-amber-900">
                    &ldquo;{item.interrupt.questionText}&rdquo;
                  </p>
                </div>
              );
            }

            const isActive = item.segment.index === currentSegmentIndex;
            const isAfterInterrupt = Boolean(item.segment.generatedAfterInterrupt);
            const isMatch = matchingIndices.has(item.segment.index);
            const isHidden = searchQuery && !isMatch && !isActive;

            return (
              <div
                key={`segment-${item.segment.id}`}
                ref={isActive ? activeRef : undefined}
                onClick={() => onSegmentClick(item.segment.index)}
                className={`cursor-pointer rounded-lg p-3 transition ${
                  isActive
                    ? 'border-2 border-violet-300 bg-violet-50 shadow-sm'
                    : isMatch
                      ? 'border-2 border-yellow-300 bg-yellow-50'
                      : 'border border-transparent hover:bg-gray-50'
                } ${isAfterInterrupt ? 'ml-2 border-l-2 border-l-amber-300' : ''} ${isHidden ? 'opacity-30' : ''}`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[10px] font-medium text-gray-400">
                    #{item.segment.index + 1}
                  </span>
                  {isAfterInterrupt && (
                    <span className="text-[10px] text-amber-500">↳ from your question</span>
                  )}
                  {isMatch && <span className="text-[10px] text-yellow-600">● match</span>}
                </div>
                <p className="text-sm">
                  <span className="font-semibold text-violet-700">Host:</span>{' '}
                  <span className="text-gray-700">
                    <HighlightText text={item.segment.hostLine} query={searchQuery} />
                  </span>
                </p>
                <p className="mt-1 text-sm">
                  <span className="font-semibold text-emerald-700">Guest:</span>{' '}
                  <span className="text-gray-700">
                    <HighlightText text={item.segment.guestLine} query={searchQuery} />
                  </span>
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
