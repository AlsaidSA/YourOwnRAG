/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * DocumentViewer — the reading pane for a parsed document. It renders the loaded page of
 * chunks as a continuous article stream, marks the chunk selected in the outline, and
 * scrolls to it. Data is supplied by the page; this component owns only presentation.
 */
import * as React from 'react';
import type { Chunk, KbDocument } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { TablePagination } from '@/components/ui/data-table';
import { EmptyState, ErrorState, type ErrorLike } from '@/components/ui/states';
import { Panel, PanelHeader, Skeleton } from '@/components/ui/surface';
import { formatNumber, formatScore, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface DocumentViewerProps {
  document: KbDocument;
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
  onPageSizeChange?: (size: number) => void;
  className?: string;
}

export function DocumentViewer({
  document,
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
  onPageSizeChange,
  className,
}: DocumentViewerProps) {
  const bodies = React.useRef<Record<string, HTMLElement | null>>({});

  React.useEffect(() => {
    if (!activeId) return;
    bodies.current[activeId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  return (
    <Panel
      elevation={1}
      className={cn('flex max-h-[80vh] flex-col overflow-hidden', className)}
    >
      <PanelHeader
        title="Parsed content"
        description={
          loading
            ? 'Loading chunks…'
            : `${formatNumber(total)} chunk${total === 1 ? '' : 's'}${
                document.parser_id ? ` · ${titleCase(document.parser_id)}` : ''
              }`
        }
      />
      <div className="or-scroll min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-lg border border-line bg-surface-1 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Skeleton className="h-2.5 w-10" />
                  <Skeleton className="h-2.5 w-16" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-11/12" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : chunks.length === 0 ? (
          <EmptyState
            title="Nothing parsed yet"
            description="This document has no chunks. Run ingestion from the document header; parsing is asynchronous and the page refreshes while it runs."
          />
        ) : (
          <div className="space-y-4">
            {chunks.map((chunk) => {
              const active = chunk.id === activeId;
              const firstPosition = chunk.positions?.[0];
              const chunkPage = typeof firstPosition?.[0] === 'number' ? firstPosition[0] : undefined;
              return (
                <article
                  key={chunk.id}
                  ref={(element) => {
                    bodies.current[chunk.id] = element;
                  }}
                  onClick={() => onSelect(chunk.id)}
                  className={cn(
                    'cursor-pointer rounded-lg border p-3 transition-colors',
                    active
                      ? 'border-line-accent bg-accent-soft'
                      : 'border-line bg-surface-1 hover:border-line-strong',
                  )}
                >
                  <header className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="font-mono text-2xs text-ink-3">#{chunk.index ?? '—'}</span>
                    {chunkPage !== undefined && (
                      <span className="font-mono text-2xs text-ink-3">p.{chunkPage}</span>
                    )}
                    <span className="font-mono text-[10px] text-ink-3">{chunk.id}</span>
                    {typeof chunk.similarity === 'number' && (
                      <Badge tone="accent" size="sm">
                        similarity {formatScore(chunk.similarity)}
                      </Badge>
                    )}
                    <span className="flex-1" />
                    {(chunk.important_kwd ?? []).slice(0, 4).map((keyword) => (
                      <Badge key={keyword} tone="neutral" size="sm">
                        {keyword}
                      </Badge>
                    ))}
                  </header>
                  <p
                    dir="auto"
                    className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2"
                  >
                    {chunk.content_with_weight || 'This chunk has no content yet.'}
                  </p>
                  {(chunk.question_kwd ?? []).length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-line pt-2">
                      {(chunk.question_kwd ?? []).map((question) => (
                        <p key={question} dir="auto" className="text-2xs text-ink-3">
                          Q · {question}
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
      {!loading && !error && total > 0 && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </Panel>
  );
}
