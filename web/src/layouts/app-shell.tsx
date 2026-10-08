/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * App shell: sidebar + topbar + routed content, with a first-run connectivity probe.
 *
 * The probe is what decides whether the console talks to the preserved backend or to the
 * bundled demo corpus. It runs once, is cheap, and is retried on demand from the banner.
 */
import * as React from 'react';
import { Outlet } from 'react-router';
import { api } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { CommandPalette } from '@/components/app/command-palette';
import { Sidebar } from '@/components/app/sidebar';
import { Topbar } from '@/components/app/topbar';
import { TooltipProvider } from '@/components/ui/controls';
import { useUiStore } from '@/store/ui';

function useConnectivityProbe() {
  const demoMode = useUiStore((state) => state.demoMode);
  const enterDemoMode = useUiStore((state) => state.enterDemoMode);

  React.useEffect(() => {
    if (demoMode) return;
    let cancelled = false;
    // Ask for the version — the cheapest endpoint that proves the API is up. A network
    // failure flips the console into demo mode; a non-zero response code does not, because
    // that means the API answered and simply refused.
    api
      .get(endpoints.systemVersion)
      .then(() => undefined)
      .catch((error: unknown) => {
        if (cancelled) return;
        const isNetwork = !(error as { status?: number })?.status && (error as { code?: number })?.code === 102;
        if (isNetwork) enterDemoMode('The OwnRAG API did not answer');
      });
    return () => {
      cancelled = true;
    };
  }, [demoMode, enterDemoMode]);
}

export function AppShell() {
  useConnectivityProbe();
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === '[' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        useUiStore.getState().setSidebarCollapsed(!useUiStore.getState().sidebarCollapsed);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setCommandOpen]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-full w-full overflow-hidden bg-canvas">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>
        <CommandPalette />
      </div>
    </TooltipProvider>
  );
}
