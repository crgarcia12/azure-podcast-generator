'use client';

import { useEffect, useRef } from 'react';
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

export default function SessionTranscript({
  segments,
  interrupts,
  currentSegmentIndex,
  onSegmentClick,
}: SessionTranscriptProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current segment
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentSegmentIndex]);

  const timeline = buildTimeline(segments, interrupts);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-700">Transcript</h3>
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

            return (
              <div
                key={`segment-${item.segment.id}`}
                ref={isActive ? activeRef : undefined}
                onClick={() => onSegmentClick(item.segment.index)}
                className={`cursor-pointer rounded-lg p-3 transition ${
                  isActive
                    ? 'border-2 border-violet-300 bg-violet-50 shadow-sm'
                    : 'border border-transparent hover:bg-gray-50'
                } ${isAfterInterrupt ? 'ml-2 border-l-2 border-l-amber-300' : ''}`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[10px] font-medium text-gray-400">
                    #{item.segment.index + 1}
                  </span>
                  {isAfterInterrupt && (
                    <span className="text-[10px] text-amber-500">↳ from your question</span>
                  )}
                </div>
                <p className="text-sm">
                  <span className="font-semibold text-violet-700">Host:</span>{' '}
                  <span className="text-gray-700">{item.segment.hostLine}</span>
                </p>
                <p className="mt-1 text-sm">
                  <span className="font-semibold text-emerald-700">Guest:</span>{' '}
                  <span className="text-gray-700">{item.segment.guestLine}</span>
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
