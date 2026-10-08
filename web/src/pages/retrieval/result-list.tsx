/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Ranked results for the retrieval console. Owns the four required states for the run:
 * loading (shape-matched skeleton), error (with retry), empty (before a run, and when a run
 * returns nothing above the threshold) and loaded. Sorting is a view concern only — the card
 * keeps the backend's own rank index, so re-sorting never rewrites provenance.
 */
import * as React from 'react';
import { AlertTriangle, Inbox, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Skeleton, Toolbar } from '@/components/ui/surface';
import type { Chunk } from '@/api/types';
import { formatNumber, formatScore } from '@/lib/format';
import { ChunkResultCard } from '@/pages/retrieval/chunk-result-card';

type SortMode = 'ranked' | 'vector' | 'rerank';

export interface ResultListProps {
  chunks: Chunk[] | undefined;
  total?: number;
  keywords?: string[];
  elapsedMs?: number;
  threshold?: number;
  loading: boolean;
  error: { message?: string; code?: number } | null;
  hasRun: boolean;
  /** True when the draft differs from the settings the last run actually used. */
  dirty?: boolean;
  onRetry: () => void;
  onRun: () => void;
  onRelaxThreshold: () => void;
}

function ResultSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-lg border border-line bg-surface-1 p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="ml-auto h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-11/12" />
          <Skeleton className="mt-2 h-3 w-3/4" />
          <div className="mt-3 flex gap-3">
            <Skeleton className="h-1 w-24 rounded-full" />
            <Skeleton className="h-1 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResultList({
  chunks,
  total,
  keywords,
  elapsedMs,
  threshold,
  loading,
  error,
  hasRun,
  dirty,
  onRetry,
  onRun,
  onRelaxThreshold,
}: ResultListProps) {
  const [sort, setSort] = React.useState<SortMode>('ranked');
  const list = chunks ?? [];
  const hasRerank = React.useMemo(
    () => list.some((chunk) => typeof chunk.rerank_score === 'number'),
    [list],
  );

  const sortOptions = React.useMemo(() => {
    const options: Array<{ value: SortMode; label: string }> = [{ value: 'ranked', label: 'Ranked' }];
    options.push({ value: 'vector', label: 'Vector' });
    if (hasRerank) options.push({ value: 'rerank', label: 'Rerank' });
    return options;
  }, [hasRerank]);

  const sorted = React.useMemo(() => {
    const copy = [...list];
    if (sort === 'vector') {
      copy.sort((a, b) => (b.vector_similarity ?? 0) - (a.vector_similarity ?? 0));
    } else if (sort === 'rerank') {
      copy.sort((a, b) => (b.rerank_score ?? -1) - (a.rerank_score ?? -1));
    }
    return copy;
  }, [list, sort]);

  if (loading) {
    return <ResultSkeleton count={4} />;
  }

  if (error) {
    return <ErrorState title="Retrieval failed" error={error} onRetry={onRetry} />;
  }

  if (!hasRun) {
    return (
      <EmptyState
        icon={<Search />}
        title="No query run yet"
        description="Choose at least one knowledge base, write a query in the settings panel, then run retrieval to rank the chunks it returns."
      />
    );
  }

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="No chunks above the threshold"
        description={
          typeof threshold === 'number'
            ? `Nothing in the selected knowledge bases scored at or above ${formatScore(threshold, 2)}. Lower the threshold, widen the candidate count, or disable reranking and run again.`
            : 'Nothing in the selected knowledge bases matched. Lower the threshold or widen the candidate count and run again.'
        }
        action={
          <Button variant="secondary" size="sm" onClick={onRelaxThreshold}>
            Lower threshold by 0.05
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Toolbar className="justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-baseline gap-1.5">
            <span className="font-mono text-sm text-ink">{formatNumber(total ?? list.length)}</span>
            <span className="text-2xs text-ink-3">chunks</span>
          </span>
          {typeof elapsedMs === 'number' && (
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono text-xs text-ink-2">{formatNumber(elapsedMs)}</span>
              <span className="text-2xs text-ink-3">ms</span>
            </span>
          )}
          {keywords && keywords.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {keywords.slice(0, 8).map((keyword) => (
                <Badge key={keyword} tone="neutral" size="sm">
                  {keyword}
                </Badge>
              ))}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <>
              <Badge tone="warn" size="sm" dot>
                Settings changed
              </Badge>
              <Button variant="subtle" size="xs" onClick={onRun}>
                Re-run
              </Button>
            </>
          )}
          <Segmented size="sm" value={sort} onValueChange={setSort} options={sortOptions} />
        </div>
      </Toolbar>

      <div className="flex flex-col gap-3">
        {sorted.map((chunk, index) => (
          <ChunkResultCard
            key={chunk.id ?? index}
            chunk={chunk}
            rank={index + 1}
            keywords={keywords}
          />
        ))}
      </div>

      {list.length === 1 && (
        <p className="flex items-center gap-1.5 px-1 text-2xs text-ink-3">
          <Inbox className="size-3" />
          Only one chunk cleared the threshold — widen the candidate count to surface more.
        </p>
      )}
    </div>
  );
}
