/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Toasts. A tiny store-backed queue rendered bottom-right; used for mutations and for the
 * demo-mode notice. No dependency, fully themed, keyboard dismissable.
 */
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useUiStore, type Toast } from '@/store/ui';
import { cn } from '@/lib/utils';

const icons = {
  default: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

const tones: Record<NonNullable<Toast['variant']>, string> = {
  default: 'text-ink-2',
  info: 'text-info',
  success: 'text-ok',
  warning: 'text-warn',
  error: 'text-danger',
};

export function Toaster() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = icons[toast.variant] ?? Info;
        return (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex gap-2.5 rounded-lg border border-line-strong bg-surface-3 p-3 shadow-e3 or-rise-in"
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', tones[toast.variant])} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ink">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">{toast.description}</p>
              )}
              {toast.action && (
                <button
                  type="button"
                  className="mt-1.5 text-2xs font-medium text-accent underline underline-offset-2"
                  onClick={() => {
                    toast.action?.onClick();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
              className="shrink-0 rounded p-0.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Imperative helper so mutation callbacks do not need the hook. */
export const toast = (input: Omit<Toast, 'id'>) => useUiStore.getState().toast(input);
