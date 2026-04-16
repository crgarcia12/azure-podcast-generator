'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

interface User {
  username: string;
  role: string;
  createdAt: string;
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(dateStr));
}

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const router = useRouter();

  function fetchProfile() {
    setLoading(true);
    setError(false);
    apiFetch('/api/auth/me')
      .then((res) => {
        if (res.status === 401) {
          router.push('/login');
          return null;
        }
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      })
      .then((data) => {
        if (data) setUser(data);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center">
        <p className="text-gray-500">Loading profile…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] flex-col items-center justify-center gap-4">
        <p className="text-red-600">Failed to load profile.</p>
        <button
          onClick={fetchProfile}
          className="rounded-xl bg-violet-600 px-4 py-2 font-medium text-white hover:bg-violet-700"
        >
          Retry
        </button>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main className="flex min-h-[calc(100vh-57px)] items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-3xl font-bold text-white">
          {user.username.charAt(0).toUpperCase()}
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{user.username}</h1>
        <span data-testid="role-badge" className="inline-block rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-700">
          {user.role}
        </span>
        <p className="text-sm text-gray-500">
          Member since {formatDate(user.createdAt)}
        </p>
        <Link
          href="/podcasts"
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-md transition hover:from-violet-700 hover:to-indigo-700"
        >
          🎙 Open Studio
        </Link>
        <button
          onClick={async () => {
            await apiFetch('/api/auth/logout', { method: 'POST' });
            router.push('/login');
          }}
          className="block w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
        >
          Logout
        </button>
      </div>
    </main>
  );
}
