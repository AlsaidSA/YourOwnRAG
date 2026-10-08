/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Topbar — global chrome only: mobile menu, breadcrumb, search trigger, live/demo state,
 * theme and account. Page-specific actions live in the page's own PageHeader.
 */
import { AlertTriangle, Menu, Moon, Search, Sun } from 'lucide-react';
import * as React from 'react';
import { Link, useLocation } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Hint, Kbd, TooltipProvider } from '@/components/ui/controls';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSystemInfo } from '@/api/hooks';
import { useUiStore } from '@/store/ui';

const CRUMB_LABELS: Record<string, string> = {
  knowledge: 'Knowledge',
  retrieval: 'Retrieval',
  chat: 'Chat',
  agents: 'Agents',
  models: 'Models',
  'data-sources': 'Data sources',
  memory: 'Memory',
  mcp: 'MCP servers',
  developers: 'Developers',
  settings: 'Settings',
};

export function Topbar() {
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const theme = useUiStore((state) => state.theme);
  const demoMode = useUiStore((state) => state.demoMode);
  const demoReason = useUiStore((state) => state.demoReason);
  const location = useLocation();
  const { data: system } = useSystemInfo();

  const segments = location.pathname.split('/').filter(Boolean);

  return (
    <TooltipProvider delayDuration={200}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-3">
        <Button
          size="icon-sm"
          variant="ghost"
          className="lg:hidden"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
        >
          <Menu />
        </Button>

        <nav className="flex min-w-0 items-center gap-1.5 text-xs">
          <Link to="/" className="shrink-0 text-ink-3 transition-colors hover:text-ink">
            OwnRAG
          </Link>
          {segments.map((segment, index) => {
            const path = `/${segments.slice(0, index + 1).join('/')}`;
            const label = CRUMB_LABELS[segment] ?? decodeURIComponent(segment);
            const isLast = index === segments.length - 1;
            return (
              <React.Fragment key={path}>
                <span className="text-ink-3">/</span>
                {isLast ? (
                  <span className="min-w-0 truncate text-ink">{label}</span>
                ) : (
                  <Link to={path} className="min-w-0 truncate text-ink-3 transition-colors hover:text-ink">
                    {label}
                  </Link>
                )}
              </React.Fragment>
            );
          })}
        </nav>

        <span className="flex-1" />

        {demoMode ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="outline-none">
                <Badge tone="warn" size="md" dot className="cursor-default">
                  Demo data
                </Badge>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Why am I seeing demo data?</DropdownMenuLabel>
              <div className="flex gap-2 px-2 pb-2 pt-0.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
                <p className="text-2xs leading-relaxed text-ink-2">
                  {demoReason ?? 'The API server did not answer'}. OwnRAG is rendering its bundled
                  sample corpus so the console stays usable. Nothing on screen comes from your
                  backend, and writes are discarded.
                </p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.location.reload()}>
                Retry the API connection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Badge tone="ok" size="md" dot>
            Live
          </Badge>
        )}

        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="hidden h-7 items-center gap-2 rounded-md border border-line bg-inset px-2 text-xs text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2 sm:flex"
        >
          <Search className="size-3.5" />
          <span>Search</span>
          <span className="flex items-center gap-0.5">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        <Hint label={`OwnRAG ${system?.version ?? ''} — switch theme`} side="bottom">
          <Button size="icon-sm" variant="ghost" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </Hint>
      </header>
    </TooltipProvider>
  );
}
