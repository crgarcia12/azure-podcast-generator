'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { useInteractiveSession } from '../../hooks/useInteractiveSession';

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    generating: 'bg-amber-100 text-amber-700',
    ready: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  };
  const cls = styles[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export default function SessionsPage() {
  const router = useRouter();
  const {
    sessions,
    loading,
    error,
    clearError,
    listSessions,
    createSession,
    deleteSession,
  } = useInteractiveSession();
  const [authChecked, setAuthChecked] = useState(false);
  const [topic, setTopic] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((res) => {
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        setAuthChecked(true);
        listSessions();
      })
      .catch(() => router.push('/login'));
  }, [router, listSessions]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!topic.trim()) return;
    setCreating(true);
    clearError();
    const session = await createSession(topic.trim());
    setCreating(false);
    if (session) {
      router.push(`/podcasts/sessions/${session.id}`);
    }
  }

  async function handleDelete(sessionId: string) {
    if (!window.confirm('Delete this episode?')) return;
    await deleteSession(sessionId);
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <Link
            href="/podcasts"
            className="text-sm text-gray-500 hover:text-gray-700 transition"
          >
            ← Back to Studio
          </Link>
          <Link
            href="/podcasts"
            className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
          >
            + New Episode
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          🎙️ Interactive Sessions
        </h1>
        <p className="mt-2 text-gray-600">
          Create a podcast and steer the conversation in real time. Ask questions, challenge points, and explore topics that spark your curiosity.
        </p>
      </div>

      {/* Create new session */}
      <form onSubmit={handleCreate} className="mb-8 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <label htmlFor="session-topic" className="mb-2 block text-sm font-medium text-gray-700">
          Start a new interactive podcast
        </label>
        <div className="flex gap-2">
          <input
            id="session-topic"
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Enter a topic (e.g., quantum computing)"
            maxLength={120}
            disabled={creating}
            className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm placeholder-gray-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={creating || !topic.trim()}
            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Session list */}
      {loading && sessions.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-12 text-center">
          <p className="text-lg font-medium text-gray-500">No sessions yet</p>
          <p className="mt-1 text-sm text-gray-400">
            Create your first interactive podcast above!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            Past Sessions
          </h2>
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => router.push(`/podcasts/sessions/${s.id}`)}
              className="group relative flex items-start justify-between rounded-xl border border-gray-200 bg-white p-4 cursor-pointer transition hover:border-violet-200 hover:shadow-md"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="truncate text-base font-semibold text-gray-900 group-hover:text-violet-700">
                    {s.topic}
                  </h3>
                  {statusBadge(s.status)}
                </div>
                <p className="truncate text-sm text-gray-500">{s.title}</p>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-400">
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {s.segmentCount} segment{s.segmentCount !== 1 ? 's' : ''}
                  </span>
                  {s.interruptCount > 0 && (
                    <span className="text-amber-500">{s.interruptCount} interrupt{s.interruptCount !== 1 ? 's' : ''}</span>
                  )}
                  <span>{relativeTime(s.createdAt)}</span>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                className="ml-3 shrink-0 rounded-lg p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-500"
                aria-label="Delete session"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
