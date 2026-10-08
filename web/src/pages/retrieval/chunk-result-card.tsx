/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * A single retrieved chunk, rendered the way an operator reads it: rank, provenance,
 * the fused/vector/keyword scores, and the matched keyword spans. Scores and ids are mono;
 * the body is plain text (never HTML), with keyword emphasis applied client-side from the
 * terms the backend actually returned.
 */
import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MeterBar } from '@/components/ui/charts';
import { Hint } from '@/components/ui/controls';
import { toast } from '@/components/ui/toaster';
import type { Chunk } from '@/api/types';
import { formatScore } from '@/lib/format';
import { cn } from '@/lib/utils';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Emphasis for keyword spans — split-based, so the chunk body is never treated as markup. */
function emphasize(text: string, terms: string[]): React.ReactNode {
  const cleaned = terms.map((term) => term.trim()).filter((term) => term.length > 1).slice(0, 12);
  if (cleaned.length === 0) return text;
  const lookup = new Set(cleaned.map((term) => term.toLowerCase()));
  const pattern = new RegExp(`(${cleaned.map(escapeRegExp).join('|')})`, 'gi');
  return text.split(pattern).map((part, index) =>
    lookup.has(part.toLowerCase()) ? (
      <mark key={index} className="rounded-[3px] bg-accent-soft px-0.5 text-ink">
        {part}
      </mark>
    ) : (
      <React.Fragment key={index}>{part}</React.Fragment>
    ),
  );
}

function ScoreMeter({
  label,
  value,
  tone,
}: {
  label: string;
  value?: number;
  tone: 'accent' | 'violet';
}) {
  return (
    <div className="min-w-[7rem] flex-1">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-2xs text-ink-3">{label}</span>
        <span className="font-mono text-2xs text-ink-2">{formatScore(value)}</span>
      </div>
      <MeterBar value={typeof value === 'number' ? value : 0} tone={tone} />
    </div>
  );
}

export interface ChunkResultCardProps {
  chunk: Chunk;
  /** Position in the list as currently sorted (1-based). */
  rank: number;
  /** Query keywords as returned by the backend, used only for emphasis. */
  keywords?: string[];
}

export function ChunkResultCard({ chunk, rank, keywords = [] }: ChunkResultCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const content = chunk.content_with_weight ?? '';
  const isLong = content.length > 320;
  const documentName = chunk.document_keyword?.trim() || 'Untitled document';
  const page = chunk.positions?.[0]?.[0];
  const keywordsForEmphasis = React.useMemo(() => {
    const fromChunk = (chunk.important_kwd ?? []).slice(0, 8);
    return Array.from(new Set([...(keywords ?? []).slice(0, 8), ...fromChunk]));
  }, [chunk.important_kwd, keywords]);

  const rerank = chunk.rerank_score;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(chunk.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        title: 'Could not copy the chunk id',
        description: 'The clipboard is not available in this context.',
        variant: 'error',
      });
    }
  };

  return (
    <article className="rounded-lg border border-line bg-surface-1">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 font-mono text-2xs text-ink-2">
          {rank}
        </span>
        <span className="or-truncate text-xs font-medium text-ink" title={documentName}>
          {documentName}
        </span>
        {typeof page === 'number' && (
          <Badge tone="outline" size="sm" className="hidden shrink-0 sm:inline-flex">
            p.{page}
          </Badge>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {typeof rerank === 'number' && (
            <Badge tone="violet" size="sm">
              rerank {formatScore(rerank)}
            </Badge>
          )}
          <Badge tone="accent" size="sm">
            sim {formatScore(chunk.similarity)}
          </Badge>
          <Hint label={chunk.id}>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleCopy}
              aria-label="Copy chunk id"
            >
              {copied ? <Check className="text-ok" /> : <Copy />}
            </Button>
          </Hint>
        </span>
      </header>

      <div className="px-3 py-2.5">
        <p
          className={cn(
            'whitespace-pre-wrap text-sm leading-relaxed text-ink-2',
            isLong && !expanded && 'line-clamp-4',
          )}
        >
          {emphasize(content, keywordsForEmphasis)}
        </p>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-1.5 text-2xs font-medium text-accent underline-offset-2 hover:underline"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-3 py-2">
        <ScoreMeter label="Vector" value={chunk.vector_similarity} tone="accent" />
        <ScoreMeter label="Keyword" value={chunk.term_similarity} tone="violet" />
        {(chunk.important_kwd ?? []).length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {(chunk.important_kwd ?? []).slice(0, 6).map((keyword) => (
              <Badge key={keyword} tone="neutral" size="sm">
                {keyword}
              </Badge>
            ))}
          </div>
        )}
      </footer>
    </article>
  );
}
