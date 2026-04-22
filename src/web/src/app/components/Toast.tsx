'use client';

import type { ToastItem, ToastType } from './ToastProvider';

interface ToastProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

const iconMap: Record<ToastType, { icon: string; borderClass: string }> = {
  success: { icon: '✓', borderClass: 'border-l-green-500' },
  error: { icon: '✕', borderClass: 'border-l-red-500' },
  info: { icon: 'ℹ', borderClass: 'border-l-blue-500' },
};

const iconColorMap: Record<ToastType, string> = {
  success: 'text-green-600',
  error: 'text-red-600',
  info: 'text-blue-600',
};

export default function Toast({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => {
        const { icon, borderClass } = iconMap[toast.type];
        const iconColor = iconColorMap[toast.type];

        return (
          <div
            key={toast.id}
            role="alert"
            className={`flex items-center gap-3 rounded-xl border border-l-4 ${borderClass} bg-white px-4 py-3 shadow-lg dark:bg-gray-800 dark:border-gray-700 ${
              toast.dismissing ? 'animate-toast-out' : 'animate-toast-in'
            }`}
          >
            <span className={`text-lg font-bold ${iconColor}`} aria-hidden="true">
              {icon}
            </span>
            <p className="flex-1 text-sm text-gray-800 dark:text-gray-100">{toast.message}</p>
            <button
              onClick={() => onDismiss(toast.id)}
              className="ml-2 shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              aria-label="Close notification"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
