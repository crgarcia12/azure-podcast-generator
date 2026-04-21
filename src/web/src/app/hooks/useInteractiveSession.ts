'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { apiFetch, toApiUrl } from '../lib/api';

// ─── Types ───────────────────────────────────────────────────────────

export interface Segment {
  id: string;
  index: number;
  hostLine: string;
  guestLine: string;
  status: string;
  revision: number;
  generatedAfterInterrupt?: string;
  audioUrl: string;
}

export interface Interrupt {
  id: string;
  afterSegmentId: string;
  questionText: string;
  inputMethod: 'voice' | 'text';
  createdAt: string;
}

export interface Session {
  id: string;
  topic: string;
  title: string;
  summary: string;
  revision: number;
  status: string;
  lastSegmentIndex: number;
  segments: Segment[];
  interrupts: Interrupt[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  topic: string;
  title: string;
  segmentCount: number;
  interruptCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  interruptId?: string;
  createdAt: string;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useInteractiveSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interruptLoading, setInterruptLoading] = useState(false);

  // Audio cache: segmentId → blob URL
  const audioCacheRef = useRef<Map<string, string>>(new Map());

  // Cleanup blob URLs on unmount
  useEffect(() => {
    const cache = audioCacheRef.current;
    return () => {
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const listSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/podcasts/sessions');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load sessions');
      }
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  const createSession = useCallback(async (topic: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/podcasts/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Failed to create session');
      }
      setSession(body.session);
      return body.session as Session;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/podcasts/sessions/${sessionId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Session not found');
      }
      setSession(body.session);
      setChatMessages(body.chatMessages ?? []);
      return body.session as Session;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    setError(null);
    try {
      const res = await apiFetch(`/api/podcasts/sessions/${sessionId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to delete session');
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (session?.id === sessionId) setSession(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
      return false;
    }
  }, [session]);

  const getSegmentAudioUrl = useCallback(async (sessionId: string, segmentId: string): Promise<string | null> => {
    const cached = audioCacheRef.current.get(segmentId);
    if (cached) return cached;

    try {
      const res = await fetch(toApiUrl(`/api/podcasts/sessions/${sessionId}/segments/${segmentId}/audio`), {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioCacheRef.current.set(segmentId, url);
      return url;
    } catch {
      return null;
    }
  }, []);

  const evictAudioCache = useCallback((segmentIds: string[]) => {
    for (const id of segmentIds) {
      const url = audioCacheRef.current.get(id);
      if (url) {
        URL.revokeObjectURL(url);
        audioCacheRef.current.delete(id);
      }
    }
  }, []);

  const submitInterrupt = useCallback(async (params: {
    sessionId: string;
    questionText: string;
    inputMethod: 'voice' | 'text';
    afterSegmentId: string;
  }) => {
    setInterruptLoading(true);
    setError(null);
    const clientRequestId = crypto.randomUUID();

    try {
      const res = await apiFetch(`/api/podcasts/sessions/${params.sessionId}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionText: params.questionText,
          inputMethod: params.inputMethod,
          afterSegmentId: params.afterSegmentId,
          clientRequestId,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Failed to process interrupt');
      }

      // Evict stale audio
      if (session) {
        const oldSegmentIds = session.segments
          .filter((s) => s.index > (session.segments.find((seg) => seg.id === params.afterSegmentId)?.index ?? -1))
          .map((s) => s.id);
        evictAudioCache(oldSegmentIds);
      }

      setSession(body.session);
      return body.session as Session;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process interrupt');
      return null;
    } finally {
      setInterruptLoading(false);
    }
  }, [session, evictAudioCache]);

  const sendChatMessage = useCallback(async (params: {
    sessionId: string;
    message: string;
    inputMethod: 'voice' | 'text';
    afterSegmentId: string;
  }) => {
    setInterruptLoading(true);
    setError(null);
    const clientRequestId = crypto.randomUUID();

    try {
      const res = await apiFetch(`/api/podcasts/sessions/${params.sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: params.message,
          inputMethod: params.inputMethod,
          afterSegmentId: params.afterSegmentId,
          clientRequestId,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Failed to send message');
      }

      // Evict stale audio
      if (session) {
        const oldSegmentIds = session.segments
          .filter((s) => s.index > (session.segments.find((seg) => seg.id === params.afterSegmentId)?.index ?? -1))
          .map((s) => s.id);
        evictAudioCache(oldSegmentIds);
      }

      setSession(body.session);
      if (body.chatMessages) {
        setChatMessages((prev) => [...prev, ...body.chatMessages]);
      }
      return body.session as Session;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      return null;
    } finally {
      setInterruptLoading(false);
    }
  }, [session, evictAudioCache]);

  const updateProgress = useCallback(async (sessionId: string, lastSegmentIndex: number) => {
    try {
      await apiFetch(`/api/podcasts/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastSegmentIndex }),
      });
    } catch {
      // Silent fail — progress tracking is best-effort
    }
  }, []);

  return {
    session,
    sessions,
    chatMessages,
    loading,
    error,
    interruptLoading,
    clearError,
    listSessions,
    createSession,
    loadSession,
    deleteSession,
    getSegmentAudioUrl,
    submitInterrupt,
    sendChatMessage,
    updateProgress,
  };
}
