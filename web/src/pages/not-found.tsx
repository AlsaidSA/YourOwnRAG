/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Not-found surface. Offers the two things a lost user actually needs: search and home.
 */
import { Compass, Home, Search } from 'lucide-react';
import { Link } from 'react-router';
import { OwnRagWordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/store/ui';

export default function NotFoundPage() {
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-5 bg-canvas px-6 text-center">
      <div className="or-grid-bg pointer-events-none absolute inset-0 opacity-25" />
      <div className="relative flex flex-col items-center gap-5">
        <OwnRagWordmark size="lg" />
        <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-3">
          <Compass className="size-4" />
        </div>
        <div>
          <p className="font-mono text-2xs uppercase tracking-[0.14em] text-ink-3">Error 404</p>
          <h1 className="mt-2 text-xl font-medium tracking-[-0.02em] text-ink">
            This route is not part of the console
          </h1>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-3">
            The page may have been renamed during the OwnRAG redesign — the upstream route names
            were reorganised into knowledge, retrieval, chat, agents and connect surfaces.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="primary" size="md">
            <Link to="/">
              <Home />
              Back to overview
            </Link>
          </Button>
          <Button variant="secondary" size="md" onClick={() => setCommandOpen(true)}>
            <Search />
            Search the console
          </Button>
        </div>
      </div>
    </div>
  );
}
