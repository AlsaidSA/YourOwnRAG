/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * KbMetadataPanel — the structured fields extracted from a knowledge base's documents.
 * It reads the metadata schema and the value distribution, and renders them as a compact
 * frequency list. Both reads are modelled by the demo corpus and the live backend.
 */
import { Database, RotateCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { api } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { KnowledgeKeys } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MeterBar } from '@/components/ui/charts';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Skeleton } from '@/components/ui/surface';
import { formatNumber } from '@/lib/format';

interface MetadataField {
  key: string;
  type: string;
}

interface MetadataSummaryEntry {
  key: string;
  values: Record<string, number>;
}

function useMetadataConfig(kbId: string) {
  return useQuery({
    queryKey: KnowledgeKeys.metadata(kbId),
    queryFn: () => api.get<{ fields: MetadataField[] }>(endpoints.kbMetadataConfig(kbId)),
    enabled: Boolean(kbId),
  });
}

function useMetadataSummary(kbId: string) {
  return useQuery({
    queryKey: [...KnowledgeKeys.metadata(kbId), 'summary'],
    queryFn: () => api.get<MetadataSummaryEntry[]>(endpoints.kbMetadataSummary(kbId)),
    enabled: Boolean(kbId),
  });
}

export function KbMetadataPanel({ kbId }: { kbId: string }) {
  const config = useMetadataConfig(kbId);
  const summary = useMetadataSummary(kbId);
  const loading = config.isLoading || summary.isLoading;
  const error = config.error ?? summary.error;
  const fields = config.data?.fields ?? [];
  const entries = summary.data ?? [];

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-5 w-24" />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-2.5 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        compact
        error={error}
        onRetry={() => {
          void config.refetch();
          void summary.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-2 flex items-center gap-1.5">
          <Database className="size-3.5 text-ink-3" />
          <h3 className="text-xs font-medium text-ink">Schema</h3>
        </div>
        {fields.length === 0 ? (
          <EmptyState
            compact
            title="No metadata fields"
            description="Define fields on ingestion to attach structured metadata to every chunk."
          />
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {fields.map((field) => (
              <li key={field.key}>
                <Badge tone="outline" size="md" className="gap-1.5">
                  <span className="font-mono text-2xs text-ink-2">{field.key}</span>
                  <span className="text-2xs text-ink-3">{field.type}</span>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-line pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-ink">Value distribution</h3>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Refresh metadata"
            onClick={() => {
              void config.refetch();
              void summary.refetch();
            }}
          >
            <RotateCw />
          </Button>
        </div>
        {entries.length === 0 ? (
          <EmptyState
            compact
            title="No metadata extracted yet"
            description="Once documents are parsed with a metadata schema, their value distribution appears here."
          />
        ) : (
          <div className="space-y-4">
            {entries.map((entry) => {
              const values = Object.entries(entry.values).sort((a, b) => b[1] - a[1]).slice(0, 6);
              const max = Math.max(...values.map(([, count]) => count), 1);
              const total = Object.values(entry.values).reduce((sum, count) => sum + count, 0);
              return (
                <div key={entry.key} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-2xs text-ink-2">{entry.key}</span>
                    <span className="font-mono text-2xs text-ink-3">{formatNumber(total)} values</span>
                  </div>
                  {values.map(([label, count]) => (
                    <div key={label} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="or-truncate text-2xs text-ink-2" title={label}>
                          {label}
                        </span>
                        <span className="font-mono text-2xs text-ink-3">{formatNumber(count)}</span>
                      </div>
                      <MeterBar value={count} max={max} height={3} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
