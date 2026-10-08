/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * KbRetrievalPanel — the retrieval defaults for one knowledge base, plus a live probe so an
 * operator can see the effect of a threshold before saving it. The probe runs against the
 * same search endpoint the retrieval console uses.
 */
import { Play, RotateCcw, Save, Search } from 'lucide-react';
import * as React from 'react';
import { useAvailableModels, useRunRetrieval, useUpdateKnowledgeBase } from '@/api/hooks';
import type { KnowledgeBase } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from '@/components/ui/controls';
import { Field, Input } from '@/components/ui/input';
import { EmptyState, InlineError } from '@/components/ui/states';
import { formatScore, formatPercent } from '@/lib/format';

const NO_RERANK = '__none__';

interface RetrievalForm {
  similarity_threshold: number;
  vector_similarity_weight: number;
  top_k: number;
  rerank_model: string;
}

function fromKb(kb: KnowledgeBase): RetrievalForm {
  return {
    similarity_threshold: kb.similarity_threshold ?? 0.2,
    vector_similarity_weight: kb.vector_similarity_weight ?? 0.3,
    top_k: kb.top_k ?? 1024,
    rerank_model: kb.rerank_model ?? NO_RERANK,
  };
}

export function KbRetrievalPanel({ kb }: { kb: KnowledgeBase }) {
  const update = useUpdateKnowledgeBase();
  const models = useAvailableModels();
  const preview = useRunRetrieval();

  const [form, setForm] = React.useState<RetrievalForm>(() => fromKb(kb));
  const initial = React.useRef<RetrievalForm>(fromKb(kb));
  const [question, setQuestion] = React.useState('');

  React.useEffect(() => {
    const next = fromKb(kb);
    initial.current = next;
    setForm(next);
  }, [kb.id, kb.update_time]);

  const dirty = React.useMemo(() => JSON.stringify(form) !== JSON.stringify(initial.current), [form]);

  const rerankOptions = React.useMemo(() => {
    const options = new Set<string>(models.data?.rerank ?? []);
    if (form.rerank_model && form.rerank_model !== NO_RERANK) options.add(form.rerank_model);
    return Array.from(options);
  }, [models.data?.rerank, form.rerank_model]);

  const save = () => {
    update.mutate({
      id: kb.id,
      body: {
        similarity_threshold: form.similarity_threshold,
        vector_similarity_weight: form.vector_similarity_weight,
        top_k: form.top_k,
        rerank_model: form.rerank_model === NO_RERANK ? null : form.rerank_model,
      },
    });
  };

  const runProbe = (event: React.FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    preview.mutate({
      dataset_ids: [kb.id],
      question: text,
      similarity_threshold: form.similarity_threshold,
      vector_similarity_weight: form.vector_similarity_weight,
      top_k: form.top_k,
      rerank_id: form.rerank_model === NO_RERANK ? null : form.rerank_model,
      page_size: 5,
    });
  };

  const results = preview.data?.chunks ?? [];

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Field
          label="Similarity threshold"
          action={<span className="font-mono text-2xs text-ink-2">{formatPercent(form.similarity_threshold, 0)}</span>}
          hint="Chunks scoring below this are dropped before reranking."
        >
          <Slider
            value={[form.similarity_threshold]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={([value]) =>
              setForm((previous) => ({ ...previous, similarity_threshold: value ?? 0 }))
            }
          />
        </Field>

        <Field
          label="Vector weight"
          action={<span className="font-mono text-2xs text-ink-2">{formatPercent(form.vector_similarity_weight, 0)}</span>}
          hint="Balance between vector similarity and keyword match in the fused score."
        >
          <Slider
            value={[form.vector_similarity_weight]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={([value]) =>
              setForm((previous) => ({ ...previous, vector_similarity_weight: value ?? 0 }))
            }
          />
        </Field>

        <Field label="Top K" hint="Maximum candidates pulled from the index before reranking.">
          <Input
            type="number"
            min={1}
            value={form.top_k}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              setForm((previous) => ({ ...previous, top_k: Number.isFinite(parsed) ? parsed : previous.top_k }));
            }}
          />
        </Field>

        <Field label="Rerank model" hint={models.isLoading ? 'Loading rerankers…' : 'Applied to the fused candidate list.'}>
          <Select
            value={form.rerank_model}
            onValueChange={(value) => setForm((previous) => ({ ...previous, rerank_model: value }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="No reranker" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_RERANK}>No reranker</SelectItem>
              {rerankOptions.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="flex items-center justify-end gap-1.5 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!dirty || update.isPending}
            onClick={() => setForm(fromKb(kb))}
          >
            <RotateCcw />
            Reset
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={update.isPending} disabled={!dirty}>
            <Save />
            Save retrieval
          </Button>
        </div>
      </form>

      <div className="border-t border-line pt-4">
        <div className="mb-2 flex items-center gap-1.5">
          <Search className="size-3.5 text-ink-3" />
          <h3 className="text-xs font-medium text-ink">Test retrieval</h3>
        </div>
        <form className="flex items-center gap-1.5" onSubmit={runProbe}>
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask this corpus a question"
            aria-label="Retrieval test question"
          />
          <Button type="submit" variant="secondary" size="md" loading={preview.isPending} disabled={!question.trim()}>
            <Play />
            Run
          </Button>
        </form>

        <div className="mt-3">
          {preview.isError ? (
            <InlineError message={(preview.error as Error)?.message ?? 'Retrieval failed'} />
          ) : preview.isPending ? (
            <p className="py-4 text-center text-xs text-ink-3">Running retrieval…</p>
          ) : preview.isSuccess && results.length === 0 ? (
            <EmptyState
              compact
              title="No chunks matched"
              description="Lower the similarity threshold, or check that this corpus has indexed chunks."
            />
          ) : results.length > 0 ? (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface-1">
              {results.map((chunk) => (
                <li key={chunk.id} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="or-truncate font-mono text-2xs text-ink-3" title={chunk.document_keyword}>
                      {chunk.document_keyword ?? chunk.document_id}
                    </span>
                    <Badge tone="accent" size="sm">
                      {formatScore(chunk.rerank_score ?? chunk.similarity ?? 0)}
                    </Badge>
                  </div>
                  <p dir="auto" className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-2">
                    {chunk.content_with_weight.replace(/\s+/g, ' ').trim()}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-xs text-ink-3">
              Run a query to preview the top chunks this configuration would surface.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
