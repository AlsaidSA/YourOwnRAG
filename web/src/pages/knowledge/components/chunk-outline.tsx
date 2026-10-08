/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * ChunkOutline — the compact index rail beside the document viewer. It lists the loaded
 * page of chunks with just enough signal to navigate (ordinal, snippet, keywords, score).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import type { Chunk } from '@/api/types';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, type ErrorLike } from '@/components/ui/states';
import { Panel, PanelHeader, Skeleton } from '@/components/ui/surface';
import { formatNumber, formatScore } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface ChunkOutlineProps {
  chunks: Chunk[];
  activeId?: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  error?: ErrorLike | null;
  onRetry?: () => void;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function ChunkOutline({
  chunks,
  activeId,
  onSelect,
  loading,
  error,
  onRetry,
  total,
  page,
  pageSize,
  onPageChange,
  className,
}: ChunkOutlineProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Panel
      elevation={1}
      className={cn('flex max-h-[70vh] flex-col overflow-hidden', className)}
    >
      <PanelHeader
        dense
        title="Chunks"
        description={loading ? 'Loading…' : `${formatNumber(total)} chunk${total === 1 ? '' : 's'}`}
      />
      <div className="or-scroll min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-3 p-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="space-y-1.5">
                <Skeleton className="h-2.5 w-10" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState compact error={error} onRetry={onRetry} />
        ) : chunks.length === 0 ? (
          <EmptyState
            compact
            title="No chunks"
            description="Run ingestion to parse this document into chunks."
          />
        ) : (
          <ul className="divide-y divide-line">
            {chunks.map((chunk) => {
              const active = chunk.id === activeId;
              const preview = chunk.content_with_weight.replace(/\s+/g, ' ').trim();
              return (
                <li key={chunk.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(chunk.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors',
                      active
                        ? 'border-accent bg-accent-soft'
                        : 'border-transparent hover:bg-surface-2',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-2xs text-ink-3">#{chunk.index ?? '—'}</span>
                      {typeof chunk.similarity === 'number' && (
                        <span className="font-mono text-2xs text-ink-2">{formatScore(chunk.similarity)}</span>
                      )}
                    </div>
                    <p
                      className={cn(
                        'line-clamp-2 text-xs leading-relaxed',
                        active ? 'text-ink' : 'text-ink-2',
                      )}
                    >
                      {preview || '(empty chunk)'}
                    </p>
                    {(chunk.important_kwd ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(chunk.important_kwd ?? []).slice(0, 3).map((keyword) => (
                          <span
                            key={keyword}
                            className="rounded-xs bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-ink-3"
                          >
                            {keyword}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {!loading && !error && total > pageSize && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-2">
          <span className="font-mono text-2xs text-ink-3">
            {page}/{pageCount}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Previous chunks"
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
              aria-label="Next chunks"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
