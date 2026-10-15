
import * as React from 'react';
import { Navigate } from 'react-router';
import { useAuthStore } from '@/store/auth';

const LandingPage = React.lazy(() => import('@/pages/landing-b'));

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
