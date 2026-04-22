'use client';

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import Toast from './Toast';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  timestamp: number;
  dismissing?: boolean;
}

interface ToastContextValue {
  addToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 5;
const DEFAULT_DURATION = 5000;

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType) => {
      counterRef.current += 1;
      const id = `toast-${counterRef.current}-${Date.now()}`;
      const toast: ToastItem = { id, message, type, timestamp: Date.now() };

      setToasts((prev) => {
        const next = [...prev, toast];
        // Remove oldest if over max
        while (next.length > MAX_TOASTS) {
          next.shift();
        }
        return next;
      });

      // Auto-dismiss
      setTimeout(() => {
        dismissToast(id);
      }, DEFAULT_DURATION);
    },
    [dismissToast],
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}
