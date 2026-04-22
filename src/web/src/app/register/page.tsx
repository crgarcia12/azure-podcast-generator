'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '../lib/api';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    apiFetch('/api/auth/registration-status')
      .then((res) => res.json())
      .then((data) => setRegistrationEnabled(data.enabled ?? false))
      .catch(() => setRegistrationEnabled(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.status === 201) {
        router.push('/login?registered=true');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Registration failed. Please try again.');
      }
    } catch {
      setError('An error occurred. Please try again.');
    }
  }

  if (registrationEnabled === null) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center px-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
      </main>
    );
  }

  if (!registrationEnabled) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center px-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl">
            🔒
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Registration Closed</h1>
          <p className="text-gray-600">
            New account registration is currently disabled. Please contact an administrator
            if you need access.
          </p>
          <Link
            href="/login"
            className="inline-block rounded-full bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            Sign in instead
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-57px)] items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Create an account</h1>
          <p className="mt-1 text-sm text-gray-500">Join PodCraft and start generating podcasts</p>
        </div>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
              autoComplete="new-password"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-violet-600 px-4 py-2.5 font-semibold text-white transition hover:bg-violet-700"
          >
            Create account
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-violet-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
