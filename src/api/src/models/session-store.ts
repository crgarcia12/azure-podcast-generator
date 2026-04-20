import crypto from 'node:crypto';

// ─── Types ───────────────────────────────────────────────────────────

export type SessionStatus = 'generating' | 'ready' | 'interrupted' | 'error';
export type SegmentStatus = 'pending' | 'generating' | 'ready' | 'failed' | 'stale';

export interface PodcastSegment {
  id: string;
  index: number;
  hostLine: string;
  guestLine: string;
  status: SegmentStatus;
  revision: number;
  generatedAfterInterrupt?: string;
  createdAt: string;
}

export interface UserInterrupt {
  id: string;
  clientRequestId: string;
  afterSegmentId: string;
  questionText: string;
  inputMethod: 'voice' | 'text';
  createdAt: string;
}

export interface PodcastSession {
  id: string;
  userId: string;
  topic: string;
  title: string;
  summary: string;
  revision: number;
  status: SessionStatus;
  segments: PodcastSegment[];
  interrupts: UserInterrupt[];
  pendingInterruptId?: string;
  contextSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PodcastSessionSummary {
  id: string;
  topic: string;
  title: string;
  segmentCount: number;
  interruptCount: number;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

// ─── Limits ──────────────────────────────────────────────────────────

export const SESSION_LIMITS = {
  maxSessionsPerUser: 10,
  maxSegmentsPerSession: 50,
  maxInterruptsPerSession: 20,
  questionMinLength: 5,
  questionMaxLength: 500,
  audioCacheMaxPerSession: 50,
} as const;

// ─── Storage ─────────────────────────────────────────────────────────

const sessions = new Map<string, PodcastSession>();
const audioCache = new Map<string, Buffer>();
const audioLruOrder = new Map<string, string[]>(); // sessionId → segmentId[]

// ─── Session CRUD ────────────────────────────────────────────────────

export function createSession(params: {
  userId: string;
  topic: string;
  title: string;
  summary: string;
  segments: Array<{ hostLine: string; guestLine: string }>;
}): PodcastSession {
  const userSessions = getSessionsByUser(params.userId);
  if (userSessions.length >= SESSION_LIMITS.maxSessionsPerUser) {
    throw new SessionLimitError(
      `Maximum ${SESSION_LIMITS.maxSessionsPerUser} active sessions allowed. Delete an old session first.`,
    );
  }

  const now = new Date().toISOString();
  const session: PodcastSession = {
    id: crypto.randomUUID(),
    userId: params.userId,
    topic: params.topic,
    title: params.title,
    summary: params.summary,
    revision: 0,
    status: 'ready',
    segments: params.segments.map((seg, index) => ({
      id: crypto.randomUUID(),
      index,
      hostLine: seg.hostLine,
      guestLine: seg.guestLine,
      status: 'ready' as SegmentStatus,
      revision: 0,
      createdAt: now,
    })),
    interrupts: [],
    createdAt: now,
    updatedAt: now,
  };

  sessions.set(session.id, session);
  return session;
}

export function getSessionById(sessionId: string): PodcastSession | undefined {
  return sessions.get(sessionId);
}

export function getOwnedSession(sessionId: string, userId: string): PodcastSession | undefined {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    return undefined;
  }
  return session;
}

export function getSessionsByUser(userId: string): PodcastSession[] {
  return Array.from(sessions.values())
    .filter((s) => s.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getSessionSummariesByUser(userId: string): PodcastSessionSummary[] {
  return getSessionsByUser(userId).map((s) => ({
    id: s.id,
    topic: s.topic,
    title: s.title,
    segmentCount: s.segments.filter((seg) => seg.status !== 'stale').length,
    interruptCount: s.interrupts.length,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
}

export function deleteSession(sessionId: string, userId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    return false;
  }

  // Evict all audio for this session
  for (const segment of session.segments) {
    audioCache.delete(segment.id);
  }
  audioLruOrder.delete(sessionId);
  sessions.delete(sessionId);
  return true;
}

export function updateSession(session: PodcastSession): void {
  session.updatedAt = new Date().toISOString();
  sessions.set(session.id, session);
}

// ─── Interrupt State Machine ─────────────────────────────────────────

export interface InterruptResult {
  session: PodcastSession;
  newSegments: PodcastSegment[];
}

export function beginInterrupt(
  session: PodcastSession,
  params: {
    clientRequestId: string;
    afterSegmentId: string;
    questionText: string;
    inputMethod: 'voice' | 'text';
  },
): UserInterrupt {
  // Check idempotency
  const existingInterrupt = session.interrupts.find(
    (i) => i.clientRequestId === params.clientRequestId,
  );
  if (existingInterrupt) {
    return existingInterrupt;
  }

  // Check concurrent interrupt
  if (session.pendingInterruptId) {
    throw new InterruptConflictError('Another interrupt is already being processed.');
  }

  // Validate limits
  if (session.interrupts.length >= SESSION_LIMITS.maxInterruptsPerSession) {
    throw new SessionLimitError(
      `Maximum ${SESSION_LIMITS.maxInterruptsPerSession} interrupts per session reached.`,
    );
  }

  // Validate segment exists
  const afterSegment = session.segments.find((s) => s.id === params.afterSegmentId);
  if (!afterSegment) {
    throw new SegmentNotFoundError(`Segment ${params.afterSegmentId} not found.`);
  }

  const interrupt: UserInterrupt = {
    id: crypto.randomUUID(),
    clientRequestId: params.clientRequestId,
    afterSegmentId: params.afterSegmentId,
    questionText: params.questionText,
    inputMethod: params.inputMethod,
    createdAt: new Date().toISOString(),
  };

  session.pendingInterruptId = interrupt.id;
  session.status = 'interrupted';
  session.interrupts.push(interrupt);
  updateSession(session);

  return interrupt;
}

export function completeInterrupt(
  session: PodcastSession,
  interruptId: string,
  newSegmentData: Array<{ hostLine: string; guestLine: string }>,
): InterruptResult {
  const interrupt = session.interrupts.find((i) => i.id === interruptId);
  if (!interrupt) {
    throw new Error(`Interrupt ${interruptId} not found`);
  }

  const afterSegment = session.segments.find((s) => s.id === interrupt.afterSegmentId);
  if (!afterSegment) {
    throw new Error(`After-segment ${interrupt.afterSegmentId} not found`);
  }

  // Increment revision
  session.revision += 1;
  const now = new Date().toISOString();

  // Mark segments after the interrupt point as stale and evict their audio
  const afterIndex = afterSegment.index;
  for (const seg of session.segments) {
    if (seg.index > afterIndex && seg.status !== 'stale') {
      seg.status = 'stale';
      audioCache.delete(seg.id);
    }
  }

  // Create new segments
  const activeSegments = session.segments.filter((s) => s.status !== 'stale');
  const startIndex = activeSegments.length;
  const newSegments: PodcastSegment[] = newSegmentData.map((seg, i) => ({
    id: crypto.randomUUID(),
    index: startIndex + i,
    hostLine: seg.hostLine,
    guestLine: seg.guestLine,
    status: 'ready' as SegmentStatus,
    revision: session.revision,
    generatedAfterInterrupt: interruptId,
    createdAt: now,
  }));

  // Check segment limit
  const totalActive = activeSegments.length + newSegments.length;
  if (totalActive > SESSION_LIMITS.maxSegmentsPerSession) {
    const allowed = SESSION_LIMITS.maxSegmentsPerSession - activeSegments.length;
    newSegments.splice(allowed);
  }

  session.segments.push(...newSegments);
  session.pendingInterruptId = undefined;
  session.status = 'ready';
  updateSession(session);

  return { session, newSegments };
}

export function failInterrupt(session: PodcastSession): void {
  session.pendingInterruptId = undefined;
  session.status = 'ready';
  updateSession(session);
}

// ─── Audio Cache ─────────────────────────────────────────────────────

export function getSegmentAudio(segmentId: string): Buffer | undefined {
  return audioCache.get(segmentId);
}

export function setSegmentAudio(sessionId: string, segmentId: string, audio: Buffer): void {
  const order = audioLruOrder.get(sessionId) ?? [];

  // Remove existing entry to refresh position
  const existingIndex = order.indexOf(segmentId);
  if (existingIndex !== -1) {
    order.splice(existingIndex, 1);
  }

  order.push(segmentId);

  // Evict oldest if over limit
  while (order.length > SESSION_LIMITS.audioCacheMaxPerSession) {
    const evicted = order.shift();
    if (evicted) {
      audioCache.delete(evicted);
    }
  }

  audioLruOrder.set(sessionId, order);
  audioCache.set(segmentId, audio);
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function getActiveSegments(session: PodcastSession): PodcastSegment[] {
  return session.segments
    .filter((s) => s.status !== 'stale')
    .sort((a, b) => a.index - b.index);
}

export function clearSessions(): void {
  sessions.clear();
  audioCache.clear();
  audioLruOrder.clear();
}

// ─── Errors ──────────────────────────────────────────────────────────

export class SessionLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionLimitError';
  }
}

export class InterruptConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InterruptConflictError';
  }
}

export class SegmentNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SegmentNotFoundError';
  }
}
