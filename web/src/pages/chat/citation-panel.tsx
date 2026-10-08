/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Citation inspector: the ranked passage rail plus the expanded source for the selected
 * citation. This is a first-class surface, not a tooltip — every grounded claim in the
 * transcript resolves to a real chunk here, with its own scores and ids.
 */
import { Check, Copy, ExternalLink, Quote } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MeterBar } from '@/components/ui/charts';
import { Hint } from '@/components/ui/controls';
import { EmptyState } from '@/components/ui/states';
import { DescriptionList, Panel, PanelHeader } from '@/components/ui/surface';
import { formatScore } from '@/lib/format';
import { cn, shortId } from '@/lib/utils';
import type { Citation } from '@/api/types';

/** Stable identity for a citation across re-renders: chunk id plus its rank in the answer. */
export function citationKey(citation: Citation, index?: number) {
  return `${citation.chunk_id}:${citation.index ?? (index ?? 0) + 1}`;
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Hint label={copied ? 'Copied' : 'Copy passage'}>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        className={className}
        onClick={copy}
        aria-label="Copy passage"
      >
        {copied ? <Check className="text-ok" /> : <Copy />}
      </Button>
    </Hint>
  );
}

function ScoreRow({ label, value }: { label: string; value?: number }) {
  if (typeof value !== 'number') return null;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-2xs">
        <span className="text-ink-3">{label}</span>
        <span className="font-mono text-ink-2">{formatScore(value)}</span>
      </div>
      <MeterBar className="mt-1" value={value} tone="accent" />
    </div>
  );
}

export interface CitationPanelProps {
  citations: Citation[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Knowledge bases the active assistant is linked to — enables a deep link when unambiguous. */
  datasetIds?: string[];
  className?: string;
}

export function CitationPanel({ citations, selectedKey, onSelect, datasetIds, className }: CitationPanelProps) {
  const selectedIndex = React.useMemo(() => {
    if (citations.length === 0) return -1;
    const found = citations.findIndex((citation, index) => citationKey(citation, index) === selectedKey);
    return found >= 0 ? found : 0;
  }, [citations, selectedKey]);

  const selected = selectedIndex >= 0 ? citations[selectedIndex] : null;
  const singleDataset = datasetIds && datasetIds.length === 1 ? datasetIds[0] : null;

  return (
    <Panel className={cn('flex h-full min-h-0 flex-col rounded-none border-0 bg-surface-1', className)}>
      <PanelHeader
        dense
        icon={<Quote />}
        title="Sources"
        description={
          citations.length
            ? `${citations.length} passage${citations.length === 1 ? '' : 's'} ranked by relevance`
            : 'Passages behind the answer'
        }
      />

      {citations.length === 0 ? (
        <EmptyState
          compact
          icon={<Quote />}
          title="No sources selected"
          description="Ask a question, then open a citation chip in the answer to inspect the passage it came from."
        />
      ) : (
        <>
          <div className="or-scroll max-h-[38%] shrink-0 overflow-y-auto border-b border-line p-1.5">
            {citations.map((citation, index) => {
              const key = citationKey(citation, index);
              const active = index === selectedIndex;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelect(key)}
                  aria-current={active || undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-[110ms]',
                    active ? 'bg-accent-soft' : 'hover:bg-surface-2',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px]',
                      active ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink-3',
                    )}
                  >
                    {citation.index ?? index + 1}
                  </span>
                  <span className="or-truncate min-w-0 flex-1 text-xs text-ink">{citation.doc_name}</span>
                  {typeof citation.similarity === 'number' && (
                    <span className="shrink-0 font-mono text-[10px] text-ink-3">
                      {formatScore(citation.similarity)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="or-scroll min-h-0 flex-1 overflow-y-auto p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug text-ink">{selected.doc_name}</p>
                  <p className="mt-0.5 font-mono text-2xs text-ink-3">
                    chunk {shortId(selected.chunk_id, 16)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {singleDataset && selected.doc_id ? (
                    <Hint label="Open the source document">
                      <Button asChild size="icon-xs" variant="ghost">
                        <Link to={`/knowledge/${singleDataset}/documents/${selected.doc_id}`}>
                          <ExternalLink />
                        </Link>
                      </Button>
                    </Hint>
                  ) : null}
                  <CopyButton text={selected.content} />
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                <ScoreRow label="Fused similarity" value={selected.similarity} />
                <ScoreRow label="Vector similarity" value={selected.vector_similarity} />
                <ScoreRow label="Term similarity" value={selected.term_similarity} />
              </div>

              <div className="mt-3 rounded-lg border border-line bg-inset p-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{selected.content}</p>
              </div>

              <DescriptionList
                className="mt-3"
                items={[
                  { label: 'Rank', value: `#${selected.index ?? selectedIndex + 1}` },
                  { label: 'Document id', value: shortId(selected.doc_id, 16), mono: true },
                  ...(singleDataset
                    ? [{ label: 'Knowledge base', value: <Badge tone="outline" size="sm">{singleDataset}</Badge> }]
                    : []),
                ]}
              />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
