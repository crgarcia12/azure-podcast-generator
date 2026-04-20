'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

interface User {
  username: string;
  role: string;
  createdAt: string;
}

export default function NavBar() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const hideGuestAuthLinks = pathname === '/login' || pathname === '/register';

  useEffect(() => {
    apiFetch('/api/auth/me')
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/login');
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-gray-200/60 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-gray-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 text-sm text-white">
            🎙
          </span>
          <span>PodCraft</span>
        </Link>

        {/* Mobile menu button */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 sm:hidden"
          aria-label="Toggle menu"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>

        {/* Desktop nav */}
        <div className="hidden items-center gap-1 sm:flex">
          {loading ? null : user ? (
            <>
              <Link href="/podcasts" className={`rounded-lg px-3 py-2 text-sm font-medium transition ${pathname === '/podcasts' ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                Studio
              </Link>
              <Link href="/podcasts/sessions" className={`rounded-lg px-3 py-2 text-sm font-medium transition ${pathname?.startsWith('/podcasts/sessions') ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                Interactive
              </Link>
              <Link href="/profile" className={`rounded-lg px-3 py-2 text-sm font-medium transition ${pathname === '/profile' ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                Profile
              </Link>
              {user.role === 'admin' && (
                <Link href="/admin" className={`rounded-lg px-3 py-2 text-sm font-medium transition ${pathname === '/admin' ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}>
                  Admin
                </Link>
              )}
              <div className="ml-2 h-5 w-px bg-gray-200" />
              <button
                onClick={handleLogout}
                className="ml-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-red-50 hover:text-red-600"
              >
                Sign out
              </button>
            </>
          ) : hideGuestAuthLinks ? null : (
            <>
              <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900">
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Mobile nav */}
      {menuOpen && (
        <div className="border-t border-gray-100 bg-white px-4 pb-4 pt-2 sm:hidden">
          {loading ? null : user ? (
            <div className="flex flex-col gap-1">
              <Link href="/podcasts" className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                Studio
              </Link>
              <Link href="/podcasts/sessions" className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                Interactive
              </Link>
              <Link href="/profile" className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                Profile
              </Link>
              {user.role === 'admin' && (
                <Link href="/admin" className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                  Admin
                </Link>
              )}
              <button
                onClick={handleLogout}
                className="mt-1 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Sign out
              </button>
            </div>
          ) : hideGuestAuthLinks ? null : (
            <div className="flex flex-col gap-1">
              <Link href="/login" className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
                Sign in
              </Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
