'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../lib/api';
import { useToast } from '../components/ToastProvider';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get('registered') === 'true';
  const { addToast } = useToast();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        router.push('/podcasts/sessions');
      } else {
        const data = await res.json().catch(() => ({}));
        const msg = data.error || 'Invalid username or password';
        setError(msg);
        addToast(msg, 'error');
      }
    } catch {
      setError('An error occurred. Please try again.');
      addToast('An error occurred. Please try again.', 'error');
    }
  }

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Welcome back</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Sign in to your PodCraft account</p>
      </div>

      {registered && (
        <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
          Registration successful. Please log in.
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Username
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            autoComplete="current-password"
            required
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-xl bg-violet-600 px-4 py-2.5 font-semibold text-white transition hover:bg-violet-700"
        >
          Log in
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-[calc(100vh-57px)] items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
