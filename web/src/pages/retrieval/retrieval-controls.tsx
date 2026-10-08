/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Retrieval controls — the tuning surface for /retrieval: knowledge-base scope, similarity
 * threshold, semantic/keyword blend, candidate count and reranking.
 *
 * This component owns nothing: the page holds the draft and the run state, and every control
 * here is a controlled input that reports a partial patch upward. Keeping it stateless means
 * the same settings object drives both the request and the "what am I currently querying"
 * summary, so the controls can never disagree with what was actually sent.
 */
import * as React from 'react';
import { ChevronDown, Layers, RotateCw, Sparkles, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, Input, Label, Textarea } from '@/components/ui/input';
import { Panel, PanelHeader, Spinner } from '@/components/ui/surface';
import {
  Hint,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
} from '@/components/ui/controls';
import type { KnowledgeBase } from '@/api/types';
import { formatCompact, formatScore } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The mutable tuning state of the console. 1:1 with the values that reach the search API. */
export interface RetrievalDraft {
  question: string;
  datasetIds: string[];
  similarityThreshold: number;
  /** Share of the fused score drawn from vector similarity; the rest is keyword match. */
  vectorWeight: number;
  topK: number;
  useRerank: boolean;
  rerankId: string;
  keyword: boolean;
  highlight: boolean;
}

export const DEFAULT_DRAFT: RetrievalDraft = {
  question: '',
  datasetIds: [],
  similarityThreshold: 0.2,
  vectorWeight: 0.3,
  topK: 1024,
  useRerank: false,
  rerankId: '',
  keyword: false,
  highlight: false,
};

export type RetrievalDraftPatch = Partial<RetrievalDraft>;

export interface RetrievalControlsProps {
  draft: RetrievalDraft;
  onChange: (patch: RetrievalDraftPatch) => void;
  onReset: () => void;
  running: boolean;
  knowledgeBases: KnowledgeBase[];
  knowledgeBasesLoading: boolean;
  rerankModels: string[];
  rerankModelsLoading: boolean;
  demo: boolean;
  className?: string;
}

export function RetrievalControls({
  draft,
  onChange,
  onReset,
  running,
  knowledgeBases,
  knowledgeBasesLoading,
  rerankModels,
  rerankModelsLoading,
  demo,
  className,
}: RetrievalControlsProps) {
  const toggleKnowledgeBase = (kbId: string) => {
    onChange({
      datasetIds: draft.datasetIds.includes(kbId)
        ? draft.datasetIds.filter((id) => id !== kbId)
        : [...draft.datasetIds, kbId],
    });
  };

  const selected = knowledgeBases.filter((kb) => draft.datasetIds.includes(kb.id));
  const selectedLabel =
    selected.length === 0
      ? 'Select knowledge bases'
      : selected.length === 1
        ? selected[0].name
        : `${selected.length} knowledge bases selected`;

  const placeholderBase = knowledgeBases.find((kb) => draft.datasetIds.includes(kb.id));
  const placeholder = placeholderBase
    ? `Ask something answerable from “${placeholderBase.name}”…`
    : 'Ask a question to retrieve against…';

  const rerankReady = draft.useRerank && draft.rerankId.length > 0;

  return (
    <Panel className={cn('flex flex-col', className)}>
      <PanelHeader
        title="Retrieval settings"
        description="Applied to the next run."
        icon={<SlidersHorizontal />}
        actions={
          <Hint label="Reset settings">
            <Button variant="ghost" size="icon-sm" onClick={onReset} disabled={running} aria-label="Reset settings">
              <RotateCw />
            </Button>
          </Hint>
        }
      />

      <div className="flex flex-col gap-4 p-4">
        <Field
          label="Query"
          hint={
            draft.keyword
              ? 'Keyword search is on, so exact terms are also matched.'
              : 'The question retrieval will answer from.'
          }
        >
          <Textarea
            value={draft.question}
            onChange={(event) => onChange({ question: event.target.value })}
            placeholder={placeholder}
            className="min-h-24 text-sm"
          />
        </Field>

        <Field
          label="Knowledge bases"
          hint={
            knowledgeBasesLoading
              ? 'Loading knowledge bases…'
              : knowledgeBases.length === 0
                ? 'No knowledge bases yet — create one under Knowledge first.'
                : 'Retrieve only from the selected bases.'
          }
          action={
            <span className="font-mono text-2xs text-ink-3">
              {draft.datasetIds.length}/{knowledgeBases.length}
            </span>
          }
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between font-normal"
                disabled={knowledgeBasesLoading || knowledgeBases.length === 0}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {knowledgeBasesLoading ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <Layers className="size-3.5 shrink-0 text-ink-3" />
                  )}
                  <span className="or-truncate">{selectedLabel}</span>
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-ink-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="or-scroll max-h-72 w-72 overflow-y-auto" align="start">
              <DropdownMenuLabel>Knowledge bases</DropdownMenuLabel>
              {knowledgeBases.map((kb) => (
                <DropdownMenuCheckboxItem
                  key={kb.id}
                  checked={draft.datasetIds.includes(kb.id)}
                  onCheckedChange={() => toggleKnowledgeBase(kb.id)}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className="or-truncate">{kb.name}</span>
                  <span className="ml-auto pl-3 font-mono text-2xs text-ink-3">
                    {formatCompact(kb.chunk_count)}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              {draft.datasetIds.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={false}
                    onCheckedChange={() => onChange({ datasetIds: [] })}
                    onSelect={(event) => event.preventDefault()}
                  >
                    Clear selection
                  </DropdownMenuCheckboxItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {selected.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {selected.map((kb) => (
                <span
                  key={kb.id}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2 pr-1 text-2xs text-ink-2"
                >
                  <span className="max-w-[10rem] truncate">{kb.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${kb.name}`}
                    onClick={() => toggleKnowledgeBase(kb.id)}
                    className="rounded-full p-0.5 text-ink-3 transition-colors hover:text-ink"
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Field>

        <Field
          label="Similarity threshold"
          hint="Chunks scoring below this fused value are dropped before you see them."
          action={<span className="font-mono text-2xs text-ink-2">{formatScore(draft.similarityThreshold, 2)}</span>}
        >
          <Slider
            aria-label="Similarity threshold"
            min={0}
            max={1}
            step={0.01}
            value={[draft.similarityThreshold]}
            onValueChange={(value) => onChange({ similarityThreshold: value[0] ?? 0 })}
          />
        </Field>

        <Field
          label="Semantic weight"
          hint="Share of the fused score from vector similarity; the remainder is keyword overlap."
          action={
            <span className="font-mono text-2xs text-ink-2">
              {formatScore(draft.vectorWeight, 2)} / {formatScore(1 - draft.vectorWeight, 2)}
            </span>
          }
        >
          <Slider
            aria-label="Semantic weight"
            min={0}
            max={1}
            step={0.05}
            value={[draft.vectorWeight]}
            onValueChange={(value) => onChange({ vectorWeight: value[0] ?? 0 })}
          />
        </Field>

        <Field
          label="Candidate count (top_k)"
          hint="How many candidates enter ranking before the threshold is applied."
        >
          <Input
            inputSize="sm"
            type="number"
            min={1}
            max={4096}
            value={draft.topK}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(parsed)) {
                onChange({ topK: Math.max(1, Math.min(4096, parsed)) });
              }
            }}
          />
        </Field>

        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="retrieval-keyword" className="text-xs font-medium text-ink-2">
            Use keyword search
          </Label>
          <Switch
            id="retrieval-keyword"
            checked={draft.keyword}
            onCheckedChange={(value) => onChange({ keyword: value })}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="retrieval-highlight" className="text-xs font-medium text-ink-2">
            Highlight matched spans
          </Label>
          <Switch
            id="retrieval-highlight"
            checked={draft.highlight}
            onCheckedChange={(value) => onChange({ highlight: value })}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex items-center justify-between gap-2">
            <Label
              htmlFor="retrieval-rerank"
              className="flex items-center gap-1.5 text-xs font-medium text-ink-2"
            >
              <Sparkles className="size-3.5 text-ink-3" />
              Rerank results
            </Label>
            <Switch
              id="retrieval-rerank"
              checked={draft.useRerank}
              onCheckedChange={(value) => onChange({ useRerank: value })}
            />
          </div>

          {draft.useRerank &&
            (rerankModelsLoading ? (
              <div className="flex items-center gap-2 text-2xs text-ink-3">
                <Spinner className="size-3.5" />
                Loading rerank models…
              </div>
            ) : rerankModels.length === 0 ? (
              <p className="text-2xs leading-relaxed text-ink-3">
                No rerank model is connected. Add one under Models to enable reranking.
              </p>
            ) : (
              <Field label="Rerank model">
                <Select
                  value={draft.rerankId || undefined}
                  onValueChange={(value) => onChange({ rerankId: value })}
                >
                  <SelectTrigger aria-label="Rerank model">
                    <SelectValue placeholder="Choose a rerank model" />
                  </SelectTrigger>
                  <SelectContent>
                    {rerankModels.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ))}
        </div>
      </div>

      {demo && (
        <p className="border-t border-line px-4 py-2 text-2xs leading-relaxed text-ink-3">
          Running against the bundled demo corpus. {rerankReady ? 'Reranking is applied.' : ''}
        </p>
      )}
    </Panel>
  );
}
