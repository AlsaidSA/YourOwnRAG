/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Console UI state: theme posture, navigation chrome, demo-mode flag and toasts.
 * Kept deliberately small — server state belongs to React Query, not here.
 */
import { create } from 'zustand';
import { safeStorage } from '@/lib/utils';

export type ThemeMode = 'light' | 'dark';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: 'default' | 'success' | 'error' | 'warning' | 'info';
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface UiState {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandOpen: boolean;
  /** True while the console is rendering the bundled demo corpus instead of a live backend. */
  demoMode: boolean;
  demoReason: string | null;
  toasts: Toast[];
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  enterDemoMode: (reason: string) => void;
  exitDemoMode: () => void;
  toast: (toast: Omit<Toast, 'id'> & { id?: string }) => string;
  dismissToast: (id: string) => void;
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
  const storage = safeStorage();
  if (storage) storage.setItem('ownrag.theme', theme);
}

function initialTheme(): ThemeMode {
  const storage = safeStorage();
  const stored = storage?.getItem('ownrag.theme');
  if (stored === 'light' || stored === 'dark') return stored;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: initialTheme(),
  sidebarCollapsed: false,
  mobileNavOpen: false,
  commandOpen: false,
  demoMode: false,
  demoReason: null,
  toasts: [],

  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next: ThemeMode = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    set({ theme: next });
  },
  setSidebarCollapsed: (sidebarCollapsed) => {
    const storage = safeStorage();
    if (storage) storage.setItem('ownrag.sidebar', sidebarCollapsed ? 'collapsed' : 'expanded');
    set({ sidebarCollapsed });
  },
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),

  enterDemoMode: (demoReason) => {
    if (get().demoMode) return;
    set({ demoMode: true, demoReason });
  },
  exitDemoMode: () => set({ demoMode: false, demoReason: null }),

  toast: (input) => {
    const id = input.id ?? `toast_${Math.random().toString(36).slice(2, 9)}`;
    const toast: Toast = { duration: 5200, ...input, variant: input.variant ?? 'default', id };
    set({ toasts: [...get().toasts, toast] });
    if (toast.duration && toast.duration > 0) {
      window.setTimeout(() => get().dismissToast(id), toast.duration);
    }
    return id;
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
