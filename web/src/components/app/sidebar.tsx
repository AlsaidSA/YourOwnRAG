/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Sidebar. Collapses to an icon rail; becomes an overlay drawer below `lg`.
 */
import {
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  Command,
  Database,
  LogOut,
  Moon,
  Search,
  Sun,
  User,
  X,
} from 'lucide-react';
import * as React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { useAgents, useKnowledgeBases, useSystemInfo } from '@/api/hooks';
import { OwnRagWordmark } from '@/components/brand/logo';
import { NAV_GROUPS } from '@/components/app/nav';
import { Avatar, Kbd, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/controls';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { cn } from '@/lib/utils';

function DemoChip({ collapsed }: { collapsed: boolean }) {
  const demoMode = useUiStore((state) => state.demoMode);
  if (!demoMode) return null;
  return collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="mx-auto block size-1.5 rounded-full bg-warn" />
      </TooltipTrigger>
      <TooltipContent side="right">Demo data — the API is unreachable</TooltipContent>
    </Tooltip>
  ) : (
    <Badge tone="warn" size="sm" dot>
      Demo data
    </Badge>
  );
}

export function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const setCollapsed = useUiStore((state) => state.setSidebarCollapsed);
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clear);
  const location = useLocation();
  const navigate = useNavigate();

  const { data: knowledge } = useKnowledgeBases({ page_size: 100 });
  const { data: agents } = useAgents();
  const { data: system } = useSystemInfo();

  const badges = {
    kbs: knowledge?.total,
    agents: agents?.total,
  } as const;

  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, setMobileNavOpen]);

  const nav = (
    <nav className="or-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          {!collapsed && (
            <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const Icon = item.icon;
            const active =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.match ?? item.to);
            const badge = item.badge ? badges[item.badge] : undefined;
            const link = (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'group flex h-7 items-center gap-2 rounded-md px-2 text-xs transition-colors duration-[110ms]',
                  active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2/70 hover:text-ink',
                  collapsed && 'justify-center px-0',
                )}
              >
                <Icon className={cn('size-3.5 shrink-0', active ? 'text-accent' : 'text-ink-3')} />
                {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                {!collapsed && badge !== undefined && badge > 0 && (
                  <span className="shrink-0 font-mono text-[10px] text-ink-3">{badge}</span>
                )}
              </NavLink>
            );
            return collapsed ? (
              <Tooltip key={item.to}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              link
            );
          })}
        </div>
      ))}
    </nav>
  );

  const body = (
    <>
      <div className={cn('flex h-12 shrink-0 items-center gap-2 border-b border-line px-3', collapsed && 'justify-center px-0')}>
        <OwnRagWordmark size="md" showMark markSize={18} />
        {!collapsed && <span className="flex-1" />}
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink lg:hidden"
          aria-label="Close navigation"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="shrink-0 px-2 pt-2">
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className={cn(
            'flex h-7 w-full items-center gap-2 rounded-md border border-line bg-inset px-2 text-xs text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2',
            collapsed && 'justify-center px-0',
          )}
        >
          <Search className="size-3.5 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search or jump…</span>
              <span className="flex items-center gap-0.5">
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </span>
            </>
          )}
        </button>
      </div>

      {nav}

      <div className="shrink-0 border-t border-line p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-surface-2',
                collapsed && 'justify-center px-0',
              )}
            >
              <Avatar name={user?.nickname ?? 'dnn'} size={22} />
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-ink">{user?.nickname ?? 'dnn'}</span>
                  <span className="block truncate font-mono text-[10px] text-ink-3">
                    {user?.email ?? 'local workspace'}
                  </span>
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel>
              {system?.version ? `OwnRAG ${system.version}` : 'OwnRAG workspace'}
            </DropdownMenuLabel>
            <DropdownMenuItem icon={<User />} onClick={() => navigate('/settings')}>
              Workspace settings
            </DropdownMenuItem>
            <DropdownMenuItem icon={<BookOpen />} onClick={() => navigate('/developers')}>
              API reference
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={theme === 'dark' ? <Sun /> : <Moon />}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? 'Light theme' : 'Dark theme'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              icon={<LogOut />}
              onClick={() => {
                clearSession();
                navigate('/login');
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'mt-1 hidden h-7 w-full items-center gap-2 rounded-md px-2 text-[10px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2 lg:flex',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? <ChevronsRight className="size-3.5" /> : <ChevronsLeft className="size-3.5" />}
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Collapse</span>
              <Command className="size-3" />
            </>
          )}
        </button>

        {collapsed && <div className="mt-2 flex justify-center">
          <DemoChip collapsed />
        </div>}
      </div>
    </>
  );

  return (
    <>
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r border-line bg-surface-1 transition-[width] duration-[160ms] lg:flex',
          collapsed ? 'w-[52px]' : 'w-[224px]',
        )}
      >
        {body}
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-[oklch(0.15_0.01_265/0.5)] or-fade-in"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r border-line bg-surface-1 or-rise-in">
            {body}
          </aside>
        </div>
      )}
    </>
  );
}

/** Kept here so the empty-state copy in the sidebar’s neighbours stays consistent. */
export const SidebarDatabaseIcon = Database;
