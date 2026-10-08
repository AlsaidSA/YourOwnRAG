/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * The public home: the product page for a visitor, the dashboard for a signed-in operator. One
 * route, decided by session state, so no link in the console has to know which one it is talking to.
 */
import * as React from 'react';
import { Navigate } from 'react-router';
import { useAuthStore } from '@/store/auth';

const LandingPage = React.lazy(() => import('@/pages/landing'));

function LandingFallback() {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
    </div>
  );
}

export default function HomePage() {
  const status = useAuthStore((state) => state.status);
  if (status === 'authenticated') return <Navigate to="/overview" replace />;
  return (
    <React.Suspense fallback={<LandingFallback />}>
      <LandingPage />
    </React.Suspense>
  );
}
