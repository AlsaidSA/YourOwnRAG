/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * PageHeader — the contract every screen uses for its title, description and actions.
 * Keeping it uniform is what makes the console feel like one product rather than ten pages.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  tabs,
  meta,
  className,
  sticky,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  tabs?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <div
      className={cn(
        'shrink-0 border-b border-line bg-canvas px-4 pb-0 pt-4 sm:px-6',
        sticky && 'sticky top-0 z-20',
        className,
      )}
    >
      {breadcrumb && <div className="mb-2 flex items-center gap-1.5 text-xs text-ink-3">{breadcrumb}</div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-medium tracking-[-0.015em] text-ink">{title}</h1>
          {description && (
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-3">{description}</p>
          )}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {tabs ? <div className="mt-3">{tabs}</div> : <div className="h-3" />}
    </div>
  );
}

/** Standard content frame: consistent max width and gutters on every screen. */
export function PageBody({
  children,
  className,
  wide,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        'or-scroll min-h-0 flex-1 overflow-y-auto',
        padded && 'px-4 py-4 sm:px-6 sm:py-5',
        className,
      )}
    >
      <div className={cn('mx-auto w-full', wide ? 'max-w-none' : 'max-w-[1400px]')}>{children}</div>
    </div>
  );
}
