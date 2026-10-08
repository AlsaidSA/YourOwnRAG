/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Assistant settings: identity, the generation model and its sampling, retrieval controls,
 * and the knowledge bases the assistant is allowed to ground on. Reads the assistant and the
 * available models, writes through `useUpdateAssistant`.
 */
import * as React from 'react';
import { useAssistant, useAvailableModels, useKnowledgeBases, useUpdateAssistant } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Switch } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Skeleton } from '@/components/ui/surface';
import { formatScore } from '@/lib/format';

export interface AssistantSettingsProps {
  assistantId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssistantSettings({ assistantId, open, onOpenChange }: AssistantSettingsProps) {
  const assistantQuery = useAssistant(assistantId);
  const modelsQuery = useAvailableModels();
  const kbsQuery = useKnowledgeBases({ page_size: 100 });
  const update = useUpdateAssistant();

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [system, setSystem] = React.useState('');
  const [model, setModel] = React.useState('');
  const [temperature, setTemperature] = React.useState(0.2);
  const [topP, setTopP] = React.useState(0.8);
  const [maxTokens, setMaxTokens] = React.useState(2048);
  const [similarityThreshold, setSimilarityThreshold] = React.useState(0.2);
  const [topN, setTopN] = React.useState(6);
  const [topK, setTopK] = React.useState(1024);
  const [showQuote, setShowQuote] = React.useState(true);
  const [datasetIds, setDatasetIds] = React.useState<string[]>([]);

  const assistant = assistantQuery.data;

  React.useEffect(() => {
    if (!assistant) return;
    setName(assistant.name ?? '');
    setDescription(assistant.description ?? '');
    setSystem(assistant.prompt?.system ?? '');
    setModel(assistant.llm?.model_name ?? '');
    setTemperature(assistant.llm?.temperature ?? 0.2);
    setTopP(assistant.llm?.top_p ?? 0.8);
    setMaxTokens(assistant.llm?.max_tokens ?? 2048);
    setSimilarityThreshold(assistant.prompt?.similarity_threshold ?? 0.2);
    setTopN(assistant.prompt?.top_n ?? 6);
    setTopK(assistant.prompt?.top_k ?? 1024);
    setShowQuote(assistant.prompt?.show_quote ?? true);
    setDatasetIds(assistant.dataset_ids ?? []);
  }, [assistant]);

  const modelOptions = React.useMemo(() => {
    const list = modelsQuery.data?.chat ?? [];
    if (model && !list.includes(model)) return [model, ...list];
    return list;
  }, [modelsQuery.data, model]);

  const knowledgeBases = kbsQuery.data?.items ?? [];

  const toggleDataset = (id: string, checked: boolean) => {
    setDatasetIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  };

  const save = async () => {
    if (!assistantId || !assistant) return;
    try {
      await update.mutateAsync({
        id: assistantId,
        body: {
          name: name.trim() || 'Untitled assistant',
          description,
          dataset_ids: datasetIds,
          llm: {
            ...assistant.llm,
            model_name: model,
            temperature,
            top_p: topP,
            max_tokens: maxTokens,
          },
          prompt: {
            ...(assistant.prompt ?? {}),
            system,
            similarity_threshold: similarityThreshold,
            top_n: topN,
            top_k: topK,
            show_quote: showQuote,
          },
        },
      });
      onOpenChange(false);
    } catch {
      // The mutation surfaces the error through a toast; keep the dialog open to retry.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title="Assistant settings"
          description="Grounding, generation and the knowledge bases this assistant may cite."
        />

        <DialogBody>
          {assistantQuery.isLoading ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-9 w-1/2" />
            </div>
          ) : assistantQuery.isError ? (
            <ErrorState
              compact
              title="Could not load the assistant"
              error={assistantQuery.error}
              onRetry={() => {
                void assistantQuery.refetch();
              }}
            />
          ) : !assistant ? (
            <EmptyState compact title="Assistant unavailable" description="This assistant could not be found." />
          ) : (
            <div className="flex flex-col gap-5">
              <section className="flex flex-col gap-3">
                <h3 className="text-2xs font-medium uppercase tracking-wide text-ink-3">Identity</h3>
                <Field label="Name" htmlFor="assistant-name" required>
                  <Input
                    id="assistant-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Assistant name"
                  />
                </Field>
                <Field label="Description" htmlFor="assistant-description" hint="Shown in the assistant switcher.">
                  <Textarea
                    id="assistant-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="min-h-16"
                    placeholder="What is this assistant for?"
                  />
                </Field>
                <Field label="System prompt" htmlFor="assistant-system" hint="Sent ahead of every turn.">
                  <Textarea
                    id="assistant-system"
                    value={system}
                    onChange={(event) => setSystem(event.target.value)}
                    className="min-h-24"
                    placeholder="Answer strictly from the retrieved passages and cite them."
                  />
                </Field>
              </section>

              <section className="flex flex-col gap-3 border-t border-line pt-4">
                <h3 className="text-2xs font-medium uppercase tracking-wide text-ink-3">Generation</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Model">
                    {modelsQuery.isLoading ? (
                      <Skeleton className="h-8 w-full" />
                    ) : (
                      <Select value={model} onValueChange={setModel}>
                        <SelectTrigger aria-label="Model">
                          <SelectValue placeholder="Choose a chat model" />
                        </SelectTrigger>
                        <SelectContent>
                          {modelOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                  <Field label="Max tokens" htmlFor="assistant-max-tokens">
                    <Input
                      id="assistant-max-tokens"
                      type="number"
                      min={1}
                      value={maxTokens}
                      onChange={(event) => setMaxTokens(Number(event.target.value) || 0)}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-ink-2">Temperature</span>
                      <span className="font-mono text-2xs text-ink-3">{temperature.toFixed(2)}</span>
                    </div>
                    <Slider
                      value={[temperature]}
                      min={0}
                      max={1}
                      step={0.05}
                      onValueChange={(values) => setTemperature(values[0] ?? 0)}
                      aria-label="Temperature"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-ink-2">Top-p</span>
                      <span className="font-mono text-2xs text-ink-3">{topP.toFixed(2)}</span>
                    </div>
                    <Slider
                      value={[topP]}
                      min={0}
                      max={1}
                      step={0.05}
                      onValueChange={(values) => setTopP(values[0] ?? 0)}
                      aria-label="Top-p"
                    />
                  </div>
                </div>
              </section>

              <section className="flex flex-col gap-3 border-t border-line pt-4">
                <h3 className="text-2xs font-medium uppercase tracking-wide text-ink-3">Retrieval</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Top N results" htmlFor="assistant-top-n">
                    <Input
                      id="assistant-top-n"
                      type="number"
                      min={1}
                      value={topN}
                      onChange={(event) => setTopN(Number(event.target.value) || 0)}
                    />
                  </Field>
                  <Field label="Top K candidates" htmlFor="assistant-top-k">
                    <Input
                      id="assistant-top-k"
                      type="number"
                      min={1}
                      value={topK}
                      onChange={(event) => setTopK(Number(event.target.value) || 0)}
                    />
                  </Field>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-ink-2">Similarity threshold</span>
                      <span className="font-mono text-2xs text-ink-3">{formatScore(similarityThreshold)}</span>
                    </div>
                    <Slider
                      value={[similarityThreshold]}
                      min={0}
                      max={1}
                      step={0.01}
                      onValueChange={(values) => setSimilarityThreshold(values[0] ?? 0)}
                      aria-label="Similarity threshold"
                    />
                  </div>
                </div>
                <label className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-1 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-xs text-ink">Return quoted passages</span>
                    <span className="block text-2xs text-ink-3">Attach the retrieved chunks to each answer.</span>
                  </span>
                  <Switch checked={showQuote} onCheckedChange={setShowQuote} aria-label="Return quoted passages" />
                </label>
              </section>

              <section className="flex flex-col gap-3 border-t border-line pt-4">
                <h3 className="text-2xs font-medium uppercase tracking-wide text-ink-3">
                  Knowledge bases
                  <span className="ml-1.5 font-mono">{datasetIds.length}</span>
                </h3>
                {kbsQuery.isLoading ? (
                  <div className="flex flex-col gap-1.5">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <Skeleton key={index} className="h-8 w-full" />
                    ))}
                  </div>
                ) : kbsQuery.isError ? (
                  <ErrorState
                    compact
                    title="Could not load knowledge bases"
                    error={kbsQuery.error}
                    onRetry={() => {
                      void kbsQuery.refetch();
                    }}
                  />
                ) : knowledgeBases.length === 0 ? (
                  <EmptyState
                    compact
                    title="No knowledge bases"
                    description="Create one before linking it to an assistant."
                  />
                ) : (
                  <div className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface-1">
                    {knowledgeBases.map((kb) => (
                      <label
                        key={kb.id}
                        className="flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface-2"
                      >
                        <Checkbox
                          checked={datasetIds.includes(kb.id)}
                          onCheckedChange={(checked) => toggleDataset(kb.id, checked === true)}
                          aria-label={`Link ${kb.name}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="or-truncate block text-xs text-ink">{kb.name}</span>
                          <span className="block font-mono text-[10px] text-ink-3">
                            {kb.document_count} docs · {kb.chunk_count} chunks
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={update.isPending}
            disabled={!assistant || !name.trim()}
            onClick={() => void save()}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
