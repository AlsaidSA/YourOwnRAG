/*
 * Copyright 2026 OwnRAG contributors
 * Modified from an upstream Apache-2.0 project; see NOTICE for origin and attribution.
 * Copyright 2026 The InfiniFlow Authors. Licensed under the Apache License, Version 2.0.
 *
 * Session state. A token is read back on demand so the transport layer never needs a
 * React context, and the raw Authorization value is stored exactly as the backend issues it.
 */
import { create } from 'zustand';
import { safeStorage } from '@/lib/utils';

export interface SessionUser {
  id?: string;
  email: string;
  nickname: string;
  avatar?: string | null;
  tenant_id?: string;
  /** The engine's role for this account: owner, admin or member. */
  role?: string;
  is_admin?: boolean;
  language?: string;
}

const TOKEN_KEY = 'ownrag.auth.token';
const USER_KEY = 'ownrag.auth.user';

interface AuthState {
  token: string | null;
  user: SessionUser | null;
  status: 'anonymous' | 'authenticated';
  setSession: (token: string, user?: SessionUser | null) => void;
  setUser: (user: SessionUser | null) => void;
  clear: () => void;
  hydrate: () => void;
}

function readStoredUser(): SessionUser | null {
  const storage = safeStorage();
  const raw = storage?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: safeStorage()?.getItem(TOKEN_KEY) ?? null,
  user: readStoredUser(),
  status: safeStorage()?.getItem(TOKEN_KEY) ? 'authenticated' : 'anonymous',

  setSession: (token, user = null) => {
    const storage = safeStorage();
    storage?.setItem(TOKEN_KEY, token);
    if (user) storage?.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user: user ?? readStoredUser(), status: 'authenticated' });
  },
  setUser: (user) => {
    const storage = safeStorage();
    if (user) storage?.setItem(USER_KEY, JSON.stringify(user));
    else storage?.removeItem(USER_KEY);
    set({ user });
  },
  clear: () => {
    const storage = safeStorage();
    storage?.removeItem(TOKEN_KEY);
    storage?.removeItem(USER_KEY);
    set({ token: null, user: null, status: 'anonymous' });
  },
  hydrate: () => {
    const storage = safeStorage();
    const token = storage?.getItem(TOKEN_KEY) ?? null;
    set({ token, user: readStoredUser(), status: token ? 'authenticated' : 'anonymous' });
  },
}));

/** Transport-level accessors: no React required. */
export const getAuthToken = () => useAuthStore.getState().token;
export const getCurrentUser = () => useAuthStore.getState().user;
export const clearSession = () => useAuthStore.getState().clear();
