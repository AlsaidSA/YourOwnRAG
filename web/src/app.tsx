/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Application root: query client, router, toasts, and the theme side-effect.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { RouterProvider } from 'react-router';
import { createQueryClient } from '@/api/query-client';
import { Toaster } from '@/components/ui/toaster';
import { router } from '@/routes';
import { useUiStore } from '@/store/ui';

export function App() {
  const [queryClient] = React.useState(() => createQueryClient());
  const theme = useUiStore((state) => state.theme);

  // Keep the DOM in sync with the theme store (the inline script in index.html covers first paint).
  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}
