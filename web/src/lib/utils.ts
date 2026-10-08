/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Small, dependency-light helpers shared by the whole console.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names while resolving conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Stable, human-readable id fragment for client-side list keys. */
export function shortId(id: string, length = 8) {
  if (!id) return '—';
  return id.length <= length ? id : id.slice(0, length);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Guard against writing to storage in private modes or when quota is exhausted. */
export function safeStorage() {
  try {
    const probe = '__ownrag_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
