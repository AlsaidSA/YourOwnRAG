/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Empty / error / loading states. Every async surface in the console must render something
 * intentional in all four states — this file is what keeps that consistent.
 */
import { AlertTriangle, Inbox, RotateCw, ServerCrash } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16',
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-lg border border-line bg-surface-1 text-ink-3 [&_svg]:size-4">
        {icon ?? <Inbox />}
      </div>
      <div className="max-w-sm">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && <p className="mt-1 text-xs leading-relaxed text-ink-3">{description}</p>}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-1 flex items-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export interface ErrorLike {
  message?: string;
  code?: number;
}

export function ErrorState({
  error,
  title = 'Something went wrong',
  onRetry,
  className,
  compact,
}: {
  error?: ErrorLike | null;
  title?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14',
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-lg border border-danger/40 bg-danger-soft text-danger [&_svg]:size-4">
        <AlertTriangle />
      </div>
      <div className="max-w-md">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-3">
          {error?.message ?? 'The request failed before the API could answer.'}
          {typeof error?.code === 'number' && error.code > 0 && (
            <span className="ml-1 font-mono text-2xs text-ink-3">(code {error.code})</span>
          )}
        </p>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RotateCw />
          Try again
        </Button>
      )}
    </div>
  );
}

export function OfflineState({ onRetry, className }: { onRetry?: () => void; className?: string }) {
  return (
    <ErrorState
      className={className}
      title="The API is not reachable"
      error={{
        message:
          'OwnRAG could not reach the API server. Start it (or point the console at a running instance) and retry. Screens that read only from the demo corpus keep working.',
      }}
      onRetry={onRetry}
    />
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
      <ServerCrash className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button type="button" className="shrink-0 font-medium underline underline-offset-2" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Table-shaped skeleton — matches the dense list layout so the swap is not jarring. */
export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3 px-3 py-2.5">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-3', columnIndex === 0 ? 'w-1/3' : columnIndex === columns - 1 ? 'w-16' : 'w-24')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-lg border border-line bg-surface-1 p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-2.5 w-3/4" />
            </div>
          </div>
          <div className="mt-4 flex gap-4">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-lg border border-line bg-surface-1 p-3">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-3 h-6 w-24" />
          <Skeleton className="mt-3 h-6 w-16" />
        </div>
      ))}
    </div>
  );
}
