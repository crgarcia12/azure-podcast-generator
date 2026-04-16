'use client';

import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, toApiUrl } from '../lib/api';

interface PodcastTranscriptTurn {
  id: string;
  speaker: 'host' | 'guest';
  speakerLabel: 'Host' | 'Guest';
  text: string;
}

interface PodcastEpisode {
  id: string;
  topic: string;
  title: string;
  summary: string;
  createdAt: string;
  transcript: PodcastTranscriptTurn[];
  audioAvailable: boolean;
  audioUrl: string | null;
  audioContentType: string | null;
}

interface PodcastApiResponse {
  error?: string;
  episode?: PodcastEpisode;
  draftEpisode?: PodcastEpisode;
}

interface PodcastListResponse {
  episodes?: PodcastEpisode[];
}

const GENERATING_MESSAGES = [
  '🎙 Writing the script…',
  '✍️ Crafting the conversation…',
  '🗣️ Synthesizing voices…',
  '🎧 Mixing the audio…',
  '✨ Almost there…',
];

export default function PodcastsPage() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [currentEpisode, setCurrentEpisode] = useState<PodcastEpisode | null>(null);
  const [pastEpisodes, setPastEpisodes] = useState<PodcastEpisode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [genMessage, setGenMessage] = useState(GENERATING_MESSAGES[0]);

  const loadEpisodes = useCallback(async () => {
    try {
      const res = await apiFetch('/api/podcasts');
      if (res.ok) {
        const body = (await res.json()) as PodcastListResponse;
        setPastEpisodes(body.episodes ?? []);
      }
    } catch {
      // silently ignore — list is nice-to-have
    }
  }, []);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then(async (response) => {
        if (response.status === 401) {
          router.push('/login');
          return;
        }
        if (!response.ok) throw new Error('Session check failed');
        await loadEpisodes();
      })
      .catch(() => setError('Unable to load the podcast studio right now.'))
      .finally(() => setLoading(false));
  }, [router, loadEpisodes]);

  useEffect(() => {
    if (!submitting) return;
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % GENERATING_MESSAGES.length;
      setGenMessage(GENERATING_MESSAGES[idx]);
    }, 4000);
    return () => clearInterval(interval);
  }, [submitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTopic = topic.trim();
    if (!trimmedTopic) {
      setError('Please enter a topic');
      return;
    }

    setSubmitting(true);
    setError(null);
    setGenMessage(GENERATING_MESSAGES[0]);

    try {
      const response = await apiFetch('/api/podcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: trimmedTopic }),
      });

      const body = (await response.json().catch(() => ({}))) as PodcastApiResponse;

      if (!response.ok) {
        setError(body.error || 'Unable to create a podcast right now.');
        if (body.draftEpisode) setCurrentEpisode(body.draftEpisode);
        return;
      }

      if (body.episode) {
        setCurrentEpisode(body.episode);
        setPastEpisodes((prev) => [body.episode!, ...prev]);
      }
      setTopic('');
    } catch {
      setError('Unable to create a podcast right now.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleDownload(ep: PodcastEpisode) {
    if (!ep.audioUrl) return;
    const link = document.createElement('a');
    link.href = toApiUrl(ep.audioUrl);
    link.download = `${ep.title.replace(/[^a-zA-Z0-9 ]/g, '').trim()}.wav`;
    link.click();
  }

  if (loading) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
          <p className="text-sm text-gray-500">Loading studio…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-57px)] w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      {/* Hero banner */}
      <section className="rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-700 p-6 text-white shadow-lg sm:p-8">
        <div className="flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-violet-200">
          <span>🎙</span> Podcast Studio
        </div>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Create a new episode</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-indigo-100">
          Enter any topic and PodCraft will write an interview script and synthesize it with two AI voices.
        </p>
      </section>

      {/* Generator form */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-gray-900" htmlFor="podcast-topic">
              What should the episode be about?
            </label>
            <textarea
              id="podcast-topic"
              name="topic"
              rows={2}
              maxLength={120}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder='Try: "The rise and fall of Blockbuster Video" or "How mRNA vaccines work"'
              disabled={submitting}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-200 disabled:bg-gray-50 disabled:text-gray-500"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">{topic.length}/120</p>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {submitting ? (
            <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
              <p className="text-sm font-medium text-violet-700">{genMessage}</p>
            </div>
          ) : (
            <button
              type="submit"
              className="self-end rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700 hover:shadow-lg active:scale-[0.98]"
            >
              ✨ Generate episode
            </button>
          )}
        </form>
      </section>

      {/* Current episode */}
      {currentEpisode && <EpisodeCard episode={currentEpisode} onDownload={handleDownload} expanded />}

      {/* Past episodes */}
      {pastEpisodes.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-gray-900">Your episodes</h2>
          {pastEpisodes
            .filter((ep) => ep.id !== currentEpisode?.id)
            .map((ep) => (
              <EpisodeCard key={ep.id} episode={ep} onDownload={handleDownload} />
            ))}
        </section>
      )}
    </main>
  );
}

function EpisodeCard({
  episode,
  onDownload,
  expanded = false,
}: {
  episode: PodcastEpisode;
  onDownload: (ep: PodcastEpisode) => void;
  expanded?: boolean;
}) {
  const [showTranscript, setShowTranscript] = useState(expanded);

  return (
    <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-violet-100 px-3 py-0.5 text-xs font-semibold text-violet-700">
            Episode
          </span>
          <span className="text-xs text-gray-400">
            {new Date(episode.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-900">{episode.title}</h3>
          <p className="mt-1 text-sm text-gray-500">{episode.summary}</p>
        </div>

        {/* Audio player + download */}
        {episode.audioAvailable && episode.audioUrl ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <audio
              aria-label="Podcast audio player"
              className="w-full flex-1"
              controls
              preload="metadata"
              src={toApiUrl(episode.audioUrl)}
            />
            <button
              onClick={() => onDownload(episode)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Script is ready but audio synthesis was unavailable for this episode.
          </div>
        )}
      </div>

      {/* Transcript toggle */}
      <div className="border-t border-gray-100">
        <button
          onClick={() => setShowTranscript(!showTranscript)}
          className="flex w-full items-center justify-between px-5 py-3 text-sm font-medium text-gray-600 transition hover:bg-gray-50 sm:px-6"
        >
          <span>Transcript ({episode.transcript.length} turns)</span>
          <svg
            className={`h-4 w-4 transition-transform ${showTranscript ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showTranscript && (
          <div className="flex flex-col gap-0 border-t border-gray-100 px-5 py-4 sm:px-6">
            {episode.transcript.map((turn, idx) => (
              <div
                key={turn.id}
                className={`flex gap-3 py-3 ${idx !== 0 ? 'border-t border-gray-50' : ''}`}
              >
                <div
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                    turn.speaker === 'host'
                      ? 'bg-gradient-to-br from-violet-500 to-indigo-600'
                      : 'bg-gradient-to-br from-amber-500 to-orange-500'
                  }`}
                >
                  {turn.speaker === 'host' ? 'H' : 'G'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {turn.speakerLabel}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-gray-700">{turn.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
