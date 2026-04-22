'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from './lib/api';

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((res) => setAuthenticated(res.ok))
      .catch(() => setAuthenticated(false));
  }, []);

  return (
    <main className="flex min-h-[calc(100vh-57px)] flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-700 px-4 py-20 text-center text-white sm:py-28">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
        <div className="relative mx-auto max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium backdrop-blur-sm">
            <span className="text-lg">🎙</span>
            Powered by Azure AI
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
            Turn any topic into a
            <span className="block bg-gradient-to-r from-amber-200 to-yellow-100 bg-clip-text text-transparent">
              podcast episode
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-indigo-100">
            Enter a subject, and PodCraft generates an engaging interview-style script
            with two AI voices — ready to listen in seconds.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            {authenticated === true && (
              <Link
                href="/podcasts"
                className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-indigo-700 shadow-lg transition hover:bg-indigo-50 hover:shadow-xl"
              >
                <span>🎧</span> Open Studio
              </Link>
            )}
            {authenticated === false && (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-indigo-700 shadow-lg transition hover:bg-indigo-50 hover:shadow-xl"
              >
                Sign in to start
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-16 sm:grid-cols-3 sm:px-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 text-2xl dark:bg-violet-900/40">
            ✍️
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">AI-Written Scripts</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            GPT-4o writes natural host-and-guest dialogue with narrative arc,
            expert insights, and conversational flow.
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-2xl dark:bg-blue-900/40">
            🗣️
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Natural Speech</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            Azure Speech synthesizes the script with two distinct voices,
            creating a realistic podcast listening experience.
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-2xl dark:bg-amber-900/40">
            📱
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Listen Anywhere</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            Mobile-first design — generate and listen on the go.
            Download episodes to keep them forever.
          </p>
        </div>
      </section>
    </main>
  );
}
