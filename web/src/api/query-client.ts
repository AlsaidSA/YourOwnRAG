/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * One React Query client for the console. Server state is the only client-side cache;
 * nothing in the app writes API data into a store.
 */
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Never retry a rejected request: the backend answered, and the answer was "no".
          if (error instanceof ApiError) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
