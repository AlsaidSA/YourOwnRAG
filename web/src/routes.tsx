/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Route table. Every screen is lazily loaded behind a skeleton so the shell paints instantly.
 */
import * as React from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { AppShell } from '@/layouts/app-shell';
import { useAuthStore } from '@/store/auth';

const RouteFallback = () => (
  <div className="flex flex-1 items-center justify-center">
    <div className="flex flex-col items-center gap-2">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      <p className="text-2xs text-ink-3">Loading…</p>
    </div>
  </div>
);

function lazyPage(importer: () => Promise<{ default: React.ComponentType }>) {
  const Component = React.lazy(importer);
  return (
    <React.Suspense fallback={<RouteFallback />}>
      <Component />
    </React.Suspense>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((state) => state.status);
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Public shell: no auth guard, used by login and the 404 surface. */
const PublicShell = () => <Outlet />;

export const router = createBrowserRouter([
  {
    element: <PublicShell />,
    children: [
      // `/` is the product page for a visitor and redirects an operator to their dashboard, so no
      // link inside the console needs to know which of the two it is pointing at.
      { path: '/', element: lazyPage(() => import('@/pages/home')) },
      { path: '/login', element: lazyPage(() => import('@/pages/login')) },
      { path: '/signup', element: lazyPage(() => import('@/pages/signup')) },
      { path: '*', element: lazyPage(() => import('@/pages/not-found')) },
    ],
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: '/overview', element: lazyPage(() => import('@/pages/overview')) },
      { path: '/knowledge', element: lazyPage(() => import('@/pages/knowledge/list')) },
      { path: '/knowledge/:kbId', element: lazyPage(() => import('@/pages/knowledge/detail')) },
      {
        path: '/knowledge/:kbId/documents/:docId',
        element: lazyPage(() => import('@/pages/knowledge/document')),
      },
      { path: '/retrieval', element: lazyPage(() => import('@/pages/retrieval')) },
      { path: '/chat', element: lazyPage(() => import('@/pages/chat')) },
      { path: '/chat/:chatId', element: lazyPage(() => import('@/pages/chat')) },
      { path: '/chat/:chatId/:sessionId', element: lazyPage(() => import('@/pages/chat')) },
      { path: '/agents', element: lazyPage(() => import('@/pages/agents/list')) },
      { path: '/agents/:agentId', element: lazyPage(() => import('@/pages/agents/builder')) },
      { path: '/models', element: lazyPage(() => import('@/pages/models')) },
      { path: '/data-sources', element: lazyPage(() => import('@/pages/data-sources')) },
      { path: '/memory', element: lazyPage(() => import('@/pages/memory')) },
      { path: '/mcp', element: lazyPage(() => import('@/pages/mcp')) },
      { path: '/developers', element: lazyPage(() => import('@/pages/developers')) },
      { path: '/settings', element: lazyPage(() => import('@/pages/settings')) },
    ],
  },
]);
