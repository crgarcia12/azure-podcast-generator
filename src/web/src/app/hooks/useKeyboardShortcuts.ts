'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export function useKeyboardShortcuts() {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const router = useRouter();
  const gPending = useRef(false);
  const gTimeout = useRef<NodeJS.Timeout | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setIsHelpOpen((prev) => !prev);
        return;
      }

      if (e.key === 'Escape') {
        setIsHelpOpen(false);
        return;
      }

      if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        gPending.current = true;
        if (gTimeout.current) clearTimeout(gTimeout.current);
        gTimeout.current = setTimeout(() => {
          gPending.current = false;
        }, 1000);
        return;
      }

      if (gPending.current) {
        gPending.current = false;
        if (gTimeout.current) clearTimeout(gTimeout.current);
        switch (e.key) {
          case 'h':
            router.push('/');
            break;
          case 's':
            router.push('/podcasts');
            break;
          case 'p':
            router.push('/profile');
            break;
        }
      }
    },
    [router]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { isHelpOpen, setIsHelpOpen };
}
