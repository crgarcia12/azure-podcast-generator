'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';
import { useToast } from '../components/ToastProvider';

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
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const router = useRouter();
  const { addToast } = useToast();
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

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setChangingPassword(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPasswordError(body.error || 'Failed to change password');
        return;
      }
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordForm(false);
    } catch {
      setPasswordError('Unable to change password right now');
    } finally {
      setChangingPassword(false);
    }
  }

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">Loading profile…</p>
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{user.username}</h1>
        <span data-testid="role-badge" className="inline-block rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-700">
          {user.role}
        </span>
        <p className="text-sm text-gray-500 dark:text-gray-400">
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
            addToast('You have been logged out.', 'info');
            router.push('/login');
          }}
          className="block w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          Logout
        </button>

        {/* Change Password Section */}
        {passwordSuccess && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
            Password changed successfully!
          </div>
        )}

        {!showPasswordForm ? (
          <button
            onClick={() => { setShowPasswordForm(true); setPasswordSuccess(false); }}
            className="block w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            🔒 Change Password
          </button>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-3 rounded-xl border border-gray-200 p-4 text-left dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Change Password</h3>
            {passwordError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
                {passwordError}
              </div>
            )}
            <input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <input
              type="password"
              placeholder="New password (min 8 chars)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={changingPassword}
                className="flex-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {changingPassword ? 'Changing…' : 'Update Password'}
              </button>
              <button
                type="button"
                onClick={() => { setShowPasswordForm(false); setPasswordError(null); }}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
