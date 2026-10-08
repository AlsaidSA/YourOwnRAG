/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Score panel — the read-out half of the retrieval console. It answers the question the
 * operator actually has after a run: where did the scores land, how did the semantic/keyword
 * blend divide, and which documents did the hits come from. Every figure is derived from the
 * chunks the backend returned in this run; nothing here is estimated or seeded.
 */
import * as React from 'react';
import { Activity, Gauge } from 'lucide-react';
import { Panel, PanelHeader, Skeleton } from '@/components/ui/surface';
import { EmptyState, ErrorState, StatsSkeleton } from '@/components/ui/states';
import { Histogram, MeterBar } from '@/components/ui/charts';
import type { Chunk } from '@/api/types';
import { formatNumber, formatScore } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface ScorePanelProps {
  chunks: Chunk[] | undefined;
  docAggs?: Array<{ doc_id: string; doc_name: string; count: number }>;
  total?: number;
  elapsedMs?: number;
  loading: boolean;
  error: { message?: string; code?: number } | null;
  hasRun: boolean;
  settings: {
    similarityThreshold: number;
    topK: number;
    vectorWeight: number;
    useRerank: boolean;
  };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function StatCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-3">
      <p className="text-2xs uppercase tracking-wide text-ink-3">{label}</p>
      <p className="mt-1.5 font-mono text-md text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-2xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function ScorePanel({
  chunks,
  docAggs,
  total,
  elapsedMs,
  loading,
  error,
  hasRun,
  settings,
}: ScorePanelProps) {
  const list = chunks ?? [];

  const stats = React.useMemo(() => {
    const similarity = list
      .map((chunk) => chunk.similarity)
      .filter((value): value is number => typeof value === 'number');
    const vector = list
      .map((chunk) => chunk.vector_similarity)
      .filter((value): value is number => typeof value === 'number');
    const term = list
      .map((chunk) => chunk.term_similarity)
      .filter((value): value is number => typeof value === 'number');
    const rerank = list
      .map((chunk) => chunk.rerank_score)
      .filter((value): value is number => typeof value === 'number');

    const buckets = Array.from({ length: 10 }, (_, index) => ({
      label: `${(index / 10).toFixed(1)}–${((index + 1) / 10).toFixed(1)}`,
      count: 0,
    }));
    similarity.forEach((value) => {
      const index = Math.min(9, Math.max(0, Math.floor(value * 10)));
      buckets[index].count += 1;
    });

    return {
      count: list.length,
      top: similarity.length ? Math.max(...similarity) : null,
      meanSimilarity: mean(similarity),
      meanVector: mean(vector),
      meanTerm: mean(term),
      meanRerank: mean(rerank),
      rerankCount: rerank.length,
      buckets,
    };
  }, [list]);

  const coverage = React.useMemo(() => {
    const rows = (docAggs ?? []).slice().sort((a, b) => b.count - a.count);
    const denominator = rows.reduce((sum, row) => sum + row.count, 0) || 1;
    return rows.slice(0, 6).map((row) => ({ ...row, share: row.count / denominator }));
  }, [docAggs]);

  return (
    <Panel>
      <PanelHeader
        title="Score panel"
        description="Distribution, blend and document coverage for the last run."
        icon={<Gauge />}
      />

      {loading ? (
        <div className="flex flex-col gap-4 p-4">
          <StatsSkeleton count={4} />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : error ? (
        <ErrorState compact title="No scores" error={error} />
      ) : !hasRun ? (
        <EmptyState
          compact
          icon={<Activity />}
          title="No scores yet"
          description="Run a query to see how the returned chunks score and how the vector/keyword blend divides."
        />
      ) : list.length === 0 ? (
        <EmptyState
          compact
          icon={<Activity />}
          title="Nothing to score"
          description="The last run returned no chunks, so there are no scores to plot."
        />
      ) : (
        <div className="flex flex-col gap-5 p-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCell label="Results" value={formatNumber(total ?? stats.count)} hint={`of top_k ${formatNumber(settings.topK)}`} />
            <StatCell label="Top score" value={formatScore(stats.top)} hint="highest fused similarity" />
            <StatCell label="Mean score" value={formatScore(stats.meanSimilarity)} hint={`min threshold ${formatScore(settings.similarityThreshold, 2)}`} />
            <StatCell
              label="Latency"
              value={typeof elapsedMs === 'number' ? `${formatNumber(elapsedMs)} ms` : '—'}
              hint={settings.useRerank ? 'rerank applied' : 'no rerank'}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-2">Similarity distribution</span>
              <span className="font-mono text-2xs text-ink-3">{stats.count} chunks</span>
            </div>
            <Histogram buckets={stats.buckets} height={44} />
            <div className="mt-1 flex justify-between text-2xs text-ink-3">
              <span className="font-mono">0.0</span>
              <span className="font-mono">1.0</span>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-2">Score blend</span>
              <span className="font-mono text-2xs text-ink-3">
                configured {formatScore(settings.vectorWeight, 2)} / {formatScore(1 - settings.vectorWeight, 2)}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-2xs text-ink-3">Semantic (vector)</span>
                  <span className="font-mono text-2xs text-ink-2">{formatScore(stats.meanVector)}</span>
                </div>
                <MeterBar value={stats.meanVector ?? 0} tone="accent" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-2xs text-ink-3">Keyword (term)</span>
                  <span className="font-mono text-2xs text-ink-2">{formatScore(stats.meanTerm)}</span>
                </div>
                <MeterBar value={stats.meanTerm ?? 0} tone="violet" />
              </div>
              {stats.rerankCount > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-2xs text-ink-3">Rerank (mean of {stats.rerankCount})</span>
                    <span className="font-mono text-2xs text-ink-2">{formatScore(stats.meanRerank)}</span>
                  </div>
                  <MeterBar value={stats.meanRerank ?? 0} tone="violet" />
                </div>
              )}
            </div>
          </div>

          {coverage.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-2">Document coverage</span>
                <span className="font-mono text-2xs text-ink-3">{coverage.length} documents</span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {coverage.map((row) => (
                  <li key={row.doc_id} className="flex items-center gap-2">
                    <span className="or-truncate w-40 shrink-0 text-2xs text-ink-2" title={row.doc_name}>
                      {row.doc_name}
                    </span>
                    <span className={cn('min-w-0 flex-1')}>
                      <MeterBar value={row.share} tone="accent" height={4} />
                    </span>
                    <span className="w-8 shrink-0 text-right font-mono text-2xs text-ink-3">
                      {row.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
