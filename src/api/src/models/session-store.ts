import crypto from 'node:crypto';
import { getDatabase } from './database.js';

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
  lastSegmentIndex: number;
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

// ─── DB Row Types ────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  user_id: string;
  topic: string;
  title: string;
  summary: string;
  revision: number;
  status: string;
  context_summary: string | null;
  pending_interrupt_id: string | null;
  last_segment_index: number;
  created_at: string;
  updated_at: string;
}

interface SegmentRow {
  id: string;
  session_id: string;
  idx: number;
  host_line: string;
  guest_line: string;
  status: string;
  revision: number;
  generated_after_interrupt: string | null;
  created_at: string;
}

interface InterruptRow {
  id: string;
  session_id: string;
  client_request_id: string;
  after_segment_id: string;
  question_text: string;
  input_method: string;
  created_at: string;
}

// ─── Audio Cache (in-memory, regeneratable) ──────────────────────────

const audioCache = new Map<string, Buffer>();
const audioLruOrder = new Map<string, string[]>(); // sessionId → segmentId[]

// ─── DB Helpers ──────────────────────────────────────────────────────

function loadSession(sessionId: string): PodcastSession | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow | undefined;
  if (!row) return undefined;

  const segments = db.prepare(
    'SELECT * FROM segments WHERE session_id = ? ORDER BY idx ASC',
  ).all(sessionId) as SegmentRow[];

  const interrupts = db.prepare(
    'SELECT * FROM interrupts WHERE session_id = ? ORDER BY created_at ASC',
  ).all(sessionId) as InterruptRow[];

  return {
    id: row.id,
    userId: row.user_id,
    topic: row.topic,
    title: row.title,
    summary: row.summary,
    revision: row.revision,
    status: row.status as SessionStatus,
    contextSummary: row.context_summary ?? undefined,
    pendingInterruptId: row.pending_interrupt_id ?? undefined,
    lastSegmentIndex: row.last_segment_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    segments: segments.map((s) => ({
      id: s.id,
      index: s.idx,
      hostLine: s.host_line,
      guestLine: s.guest_line,
      status: s.status as SegmentStatus,
      revision: s.revision,
      generatedAfterInterrupt: s.generated_after_interrupt ?? undefined,
      createdAt: s.created_at,
    })),
    interrupts: interrupts.map((i) => ({
      id: i.id,
      clientRequestId: i.client_request_id,
      afterSegmentId: i.after_segment_id,
      questionText: i.question_text,
      inputMethod: i.input_method as 'voice' | 'text',
      createdAt: i.created_at,
    })),
  };
}

function persistSession(session: PodcastSession): void {
  const db = getDatabase();
  // Use ON CONFLICT UPDATE to avoid DELETE+INSERT which triggers ON DELETE CASCADE
  db.prepare(`
    INSERT INTO sessions (id, user_id, topic, title, summary, revision, status, context_summary, pending_interrupt_id, last_segment_index, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id, topic = excluded.topic, title = excluded.title,
      summary = excluded.summary, revision = excluded.revision, status = excluded.status,
      context_summary = excluded.context_summary, pending_interrupt_id = excluded.pending_interrupt_id,
      last_segment_index = excluded.last_segment_index,
      created_at = excluded.created_at, updated_at = excluded.updated_at
  `).run(
    session.id,
    session.userId,
    session.topic,
    session.title,
    session.summary,
    session.revision,
    session.status,
    session.contextSummary ?? null,
    session.pendingInterruptId ?? null,
    session.lastSegmentIndex,
    session.createdAt,
    session.updatedAt,
  );
}

function persistSegments(sessionId: string, segments: PodcastSegment[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO segments (id, session_id, idx, host_line, guest_line, status, revision, generated_after_interrupt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const seg of segments) {
    stmt.run(
      seg.id,
      sessionId,
      seg.index,
      seg.hostLine,
      seg.guestLine,
      seg.status,
      seg.revision,
      seg.generatedAfterInterrupt ?? null,
      seg.createdAt,
    );
  }
}

function persistInterrupt(sessionId: string, interrupt: UserInterrupt): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR IGNORE INTO interrupts (id, session_id, client_request_id, after_segment_id, question_text, input_method, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    interrupt.id,
    sessionId,
    interrupt.clientRequestId,
    interrupt.afterSegmentId,
    interrupt.questionText,
    interrupt.inputMethod,
    interrupt.createdAt,
  );
}

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
    lastSegmentIndex: 0,
    createdAt: now,
    updatedAt: now,
  };

  const db = getDatabase();
  db.transaction(() => {
    persistSession(session);
    persistSegments(session.id, session.segments);
  })();

  return session;
}

export function getSessionById(sessionId: string): PodcastSession | undefined {
  return loadSession(sessionId);
}

export function getOwnedSession(sessionId: string, userId: string): PodcastSession | undefined {
  const session = loadSession(sessionId);
  if (!session || session.userId !== userId) {
    return undefined;
  }
  return session;
}

export function getSessionsByUser(userId: string): PodcastSession[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC',
  ).all(userId) as Array<{ id: string }>;

  const result: PodcastSession[] = [];
  for (const row of rows) {
    const session = loadSession(row.id);
    if (session) result.push(session);
  }
  return result;
}

export function getSessionSummariesByUser(userId: string): PodcastSessionSummary[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT s.id, s.topic, s.title, s.status, s.created_at, s.updated_at,
      (SELECT COUNT(*) FROM segments seg WHERE seg.session_id = s.id AND seg.status != 'stale') AS segment_count,
      (SELECT COUNT(*) FROM interrupts i WHERE i.session_id = s.id) AS interrupt_count
    FROM sessions s
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
  `).all(userId) as Array<{
    id: string;
    topic: string;
    title: string;
    status: string;
    created_at: string;
    updated_at: string;
    segment_count: number;
    interrupt_count: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    title: r.title,
    segmentCount: r.segment_count,
    interruptCount: r.interrupt_count,
    status: r.status as SessionStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function deleteSession(sessionId: string, userId: string): boolean {
  const db = getDatabase();
  const row = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(sessionId) as { user_id: string } | undefined;
  if (!row || row.user_id !== userId) {
    return false;
  }

  // Evict audio for this session's segments
  const segments = db.prepare('SELECT id FROM segments WHERE session_id = ?').all(sessionId) as Array<{ id: string }>;
  for (const seg of segments) {
    audioCache.delete(seg.id);
  }
  audioLruOrder.delete(sessionId);

  // CASCADE handles segments/interrupts
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  return true;
}

export function updateSession(session: PodcastSession): void {
  session.updatedAt = new Date().toISOString();
  const db = getDatabase();
  db.transaction(() => {
    persistSession(session);
    // Replace all segments: delete existing, re-insert all
    db.prepare('DELETE FROM segments WHERE session_id = ?').run(session.id);
    persistSegments(session.id, session.segments);
  })();
}

export function updateSessionProgress(sessionId: string, userId: string, lastSegmentIndex: number): boolean {
  const session = getOwnedSession(sessionId, userId);
  if (!session) return false;
  session.lastSegmentIndex = lastSegmentIndex;
  session.updatedAt = new Date().toISOString();
  persistSession(session);
  return true;
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

  const db = getDatabase();
  db.transaction(() => {
    persistInterrupt(session.id, interrupt);
    session.pendingInterruptId = interrupt.id;
    session.status = 'interrupted';
    session.interrupts.push(interrupt);
    session.updatedAt = new Date().toISOString();
    persistSession(session);
  })();

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
  const db = getDatabase();
  db.prepare('DELETE FROM chat_messages').run();
  db.prepare('DELETE FROM interrupts').run();
  db.prepare('DELETE FROM segments').run();
  db.prepare('DELETE FROM sessions').run();
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
