/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Surfaces: Panel/Card, SectionHeader, Toolbar, Stat, KeyValue, Skeleton, Spinner.
 * Depth is expressed by stepping the surface colour and adding a hairline, not by shadows.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Panel({
  className,
  elevation = 1,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { elevation?: 0 | 1 | 2 }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-line',
        elevation === 0 && 'bg-transparent',
        elevation === 1 && 'bg-surface-1',
        elevation === 2 && 'bg-surface-2 shadow-e2',
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  icon,
  className,
  dense,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 border-b border-line',
        dense ? 'px-3 py-2' : 'px-4 py-3',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-ink-3 [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-md font-medium tracking-[-0.01em] text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function Toolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-2 py-1.5',
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('or-shimmer rounded-md', className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin text-ink-3', className)} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
      <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function KeyValue({
  label,
  children,
  className,
  mono,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1.5', className)}>
      <span className="shrink-0 text-xs text-ink-3">{label}</span>
      <span className={cn('min-w-0 truncate text-right text-xs text-ink', mono && 'font-mono')}>
        {children}
      </span>
    </div>
  );
}

/** A hairline-separated definition list used across every detail pane. */
export function DescriptionList({
  items,
  className,
}: {
  items: Array<{ label: React.ReactNode; value: React.ReactNode; mono?: boolean }>;
  className?: string;
}) {
  return (
    <dl className={cn('divide-y divide-line', className)}>
      {items.map((item, index) => (
        <KeyValue key={index} label={item.label} mono={item.mono}>
          {item.value}
        </KeyValue>
      ))}
    </dl>
  );
}
