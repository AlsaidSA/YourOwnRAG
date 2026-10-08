/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Retrieval console — the RAG test bench. This is where an operator tunes recall over their
 * own knowledge bases: scope, similarity threshold, semantic/keyword blend, candidate count
 * and reranking, then reads back exactly which chunks each combination surfaces.
 *
 * The page owns the draft settings and the run; the controls, the ranked list and the score
 * panel are pure views over that state. The request body is 1:1 with the preserved
 * `/api/v1/datasets/search` contract, so the same code path drives the live backend and the
 * bundled demo corpus with no branching beyond copy.
 */
import * as React from 'react';
import { PageBody, PageHeader } from '@/components/app/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAvailableModels, useKnowledgeBases, useRunRetrieval } from '@/api/hooks';
import { useUiStore } from '@/store/ui';
import {
  DEFAULT_DRAFT,
  RetrievalControls,
  type RetrievalDraft,
  type RetrievalDraftPatch,
} from '@/pages/retrieval/retrieval-controls';
import { ResultList } from '@/pages/retrieval/result-list';
import { ScorePanel } from '@/pages/retrieval/score-panel';

/** Map the tuning draft onto the preserved search request. Never invents fields. */
function toRequestBody(draft: RetrievalDraft): Record<string, unknown> {
  const pageSize = Math.max(1, Math.min(200, draft.topK));
  return {
    question: draft.question.trim(),
    dataset_ids: draft.datasetIds,
    doc_ids: [],
    page: 1,
    page_size: pageSize,
    similarity_threshold: draft.similarityThreshold,
    vector_similarity_weight: draft.vectorWeight,
    top_k: draft.topK,
    rerank_id: draft.useRerank && draft.rerankId ? draft.rerankId : null,
    keyword: draft.keyword,
    highlight: draft.highlight,
  };
}

export default function RetrievalPage() {
  const [draft, setDraft] = React.useState<RetrievalDraft>(DEFAULT_DRAFT);
  const [hasRun, setHasRun] = React.useState(false);
  /** The serialized body of the settings the last run actually used. */
  const [applied, setApplied] = React.useState('');

  const knowledgeBases = useKnowledgeBases();
  const models = useAvailableModels();
  const run = useRunRetrieval();
  const demo = useUiStore((state) => state.demoMode);

  const kbItems = knowledgeBases.data?.items ?? [];
  const rerankModels = models.data?.rerank ?? [];

  // Seed a usable scope the first time the knowledge bases resolve. Guarded so a refetch or a
  // deliberate "clear selection" is never overwritten.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current) return;
    const first = knowledgeBases.data?.items?.[0];
    if (first) {
      seeded.current = true;
      setDraft((current) =>
        current.datasetIds.length > 0 ? current : { ...current, datasetIds: [first.id] },
      );
    }
  }, [knowledgeBases.data]);

  const patchDraft = React.useCallback((patch: RetrievalDraftPatch) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const canRun = draft.question.trim().length > 0 && draft.datasetIds.length > 0 && !run.isPending;

  const currentBody = React.useMemo(() => JSON.stringify(toRequestBody(draft)), [draft]);
  const dirty = hasRun && applied.length > 0 && applied !== currentBody;

  const handleRun = React.useCallback(() => {
    if (draft.question.trim().length === 0 || draft.datasetIds.length === 0) return;
    const body = toRequestBody(draft);
    setApplied(JSON.stringify(body));
    setHasRun(true);
    run.mutate(body);
  }, [draft, run]);

  const handleRetry = React.useCallback(() => {
    if (run.isPending) return;
    if (applied.length > 0) {
      try {
        run.mutate(JSON.parse(applied) as Record<string, unknown>);
        return;
      } catch {
        /* fall through to the current draft */
      }
    }
    handleRun();
  }, [applied, handleRun, run]);

  const handleReset = React.useCallback(() => {
    const first = kbItems[0];
    setDraft({ ...DEFAULT_DRAFT, datasetIds: first ? [first.id] : [] });
  }, [kbItems]);

  const handleRelaxThreshold = React.useCallback(() => {
    if (run.isPending) return;
    const next: RetrievalDraft = {
      ...draft,
      similarityThreshold: Math.max(0, Number((draft.similarityThreshold - 0.05).toFixed(2))),
    };
    const body = toRequestBody(next);
    setDraft(next);
    setApplied(JSON.stringify(body));
    setHasRun(true);
    run.mutate(body);
  }, [draft, run]);

  const result = run.data;

  return (
    <>
      <PageHeader
        title="Retrieval"
        description="Tune recall, thresholds and reranking over your knowledge bases, then inspect exactly what each combination returns before you commit it to an assistant."
        meta={
          <>
            <Badge tone="neutral" size="sm">
              {kbItems.length} knowledge bases
            </Badge>
            <Badge tone={draft.datasetIds.length > 0 ? 'accent' : 'neutral'} size="sm">
              {draft.datasetIds.length} in scope
            </Badge>
            {draft.useRerank && draft.rerankId && (
              <Badge tone="violet" size="sm">
                rerank · {draft.rerankId}
              </Badge>
            )}
            {demo && (
              <Badge tone="warn" size="sm" dot>
                Demo corpus
              </Badge>
            )}
          </>
        }
        actions={
          <Button
            variant="primary"
            size="lg"
            onClick={handleRun}
            loading={run.isPending}
            disabled={!canRun}
          >
            {run.isPending ? 'Running…' : 'Run retrieval'}
          </Button>
        }
      />

      <PageBody wide>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
          <RetrievalControls
            draft={draft}
            onChange={patchDraft}
            onReset={handleReset}
            running={run.isPending}
            knowledgeBases={kbItems}
            knowledgeBasesLoading={knowledgeBases.isLoading}
            rerankModels={rerankModels}
            rerankModelsLoading={models.isLoading}
            demo={demo}
            className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto or-scroll"
          />

          <div className="flex min-w-0 flex-col gap-4">
            <ScorePanel
              chunks={result?.chunks}
              docAggs={result?.doc_aggs}
              total={result?.total}
              elapsedMs={result?.elapsed_ms}
              loading={run.isPending}
              error={run.error}
              hasRun={hasRun}
              settings={{
                similarityThreshold: draft.similarityThreshold,
                topK: draft.topK,
                vectorWeight: draft.vectorWeight,
                useRerank: draft.useRerank,
              }}
            />
            <ResultList
              chunks={result?.chunks}
              total={result?.total}
              keywords={result?.keywords}
              elapsedMs={result?.elapsed_ms}
              threshold={draft.similarityThreshold}
              loading={run.isPending}
              error={run.error}
              hasRun={hasRun}
              dirty={dirty}
              onRetry={handleRetry}
              onRun={handleRun}
              onRelaxThreshold={handleRelaxThreshold}
            />
          </div>
        </div>
      </PageBody>
    </>
  );
}
