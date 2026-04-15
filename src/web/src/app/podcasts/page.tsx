'use client';

import { useEffect, useState, type FormEvent } from 'react';
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

export default function PodcastsPage() {
  const router = useRouter();
  const [topic, setTopic] = useState('');
  const [episode, setEpisode] = useState<PodcastEpisode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then(async (response) => {
        if (response.status === 401) {
          router.push('/login');
          return;
        }

        if (!response.ok) {
          throw new Error('Unable to validate the current session.');
        }
      })
      .catch(() => {
        setError('Unable to load the podcast generator right now.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTopic = topic.trim();

    if (!trimmedTopic) {
      setError('Topic is required');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await apiFetch('/api/podcasts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ topic: trimmedTopic }),
      });

      const body = (await response.json().catch(() => ({}))) as PodcastApiResponse;

      if (!response.ok) {
        setError(body.error || 'Unable to create a podcast right now.');
        if (body.draftEpisode) {
          setEpisode(body.draftEpisode);
        }
        return;
      }

      if (body.episode) {
        setEpisode(body.episode);
      }
      setTopic(trimmedTopic);
    } catch {
      setError('Unable to create a podcast right now.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-[80vh] items-center justify-center px-4">
        <p className="text-sm text-gray-600">Loading podcast studio…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-3xl bg-gradient-to-br from-blue-700 via-indigo-700 to-slate-900 p-6 text-white shadow-lg">
        <p className="mb-2 text-sm font-medium uppercase tracking-[0.2em] text-blue-100">
          Podcast generator
        </p>
        <h1 className="text-3xl font-semibold sm:text-4xl">Turn a topic into a spoken episode</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-50 sm:text-base">
          Pick a subject, generate an interview-style script, and listen right in the browser.
          This first version is optimized for phone-sized screens and leaves room for future
          follow-up questions.
        </p>
      </section>

      <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-900" htmlFor="podcast-topic">
              Podcast topic
            </label>
            <textarea
              id="podcast-topic"
              name="topic"
              rows={3}
              maxLength={120}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Try: The history of Boeing"
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
            <p className="text-xs text-gray-500">
              Keep it specific. The generator works best with a clear topic or angle.
            </p>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-gray-500">
              Interview mode uses a host and a guest voice for every generated episode.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {submitting ? 'Generating episode…' : 'Generate episode'}
            </button>
          </div>
        </form>
      </section>

      {episode && (
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                  Generated episode
                </span>
                <span className="text-xs text-gray-500">{new Date(episode.createdAt).toLocaleString()}</span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500">
                  Topic
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-gray-900">{episode.title}</h2>
                <p className="mt-1 text-sm text-gray-600">{episode.summary}</p>
              </div>

              {episode.audioAvailable && episode.audioUrl ? (
                <audio
                  aria-label="Podcast audio player"
                  className="w-full"
                  controls
                  preload="metadata"
                   src={toApiUrl(episode.audioUrl)}
                 />
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  The script is ready, but audio is not available for this attempt yet.
                </div>
              )}
            </div>
          </article>

          <article className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900">Transcript</h3>
            <div className="mt-4 flex flex-col gap-3">
              {episode.transcript.map((turn) => (
                <section
                  key={turn.id}
                  className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500">
                    {turn.speakerLabel}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-gray-800">{turn.text}</p>
                </section>
              ))}
            </div>
          </article>
        </section>
      )}
    </main>
  );
}
